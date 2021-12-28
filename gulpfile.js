// @ts-check

const { series, src, dest, watch } = require('gulp');
const concat = require('gulp-concat');
const del = require('del');

const ts = require('gulp-typescript');
const fs = require('fs');
const path = require('path');

const transformer = require('bm-thing-transformer');

const xml2js = require('xml2js');
const gulpZip = require('gulp-zip');
const request = require('request');

// @ts-ignore
const package = require('./package.json');
const zipName = `${package.packageName}-${package.version}.zip`;

// @ts-ignore
const twConfig = require('./twconfig.json');

const { spawn } = require('child_process');

require('dotenv').config();

let isCombinedBuild = false;

const thingworxConnectionDetails = (() => {
    if (!process.env.THINGWORX_SERVER) {
        console.error('The thingworx server is not defined in your environment, defaulting to loading from package.json');
        return ({
            thingworxServer: package.thingworxServer,
            thingworxUser: package.thingworxUser,
            thingworxPassword: package.thingworxPassword,
            thingworxAppKey: package.thingworxAppKey
        });
    }
    else {
        return ({
            thingworxServer: process.env.THINGWORX_SERVER,
            thingworxUser: process.env.THINGWORX_USER,
            thingworxPassword: process.env.THINGWORX_PASSWORD,
            thingworxAppKey: process.env.THINGWORX_APPKEY
        });
    }
})();

async function buildJava() {
    isCombinedBuild = true;
    await new Promise(resolve => {
        spawn('./gradlew', ['prepPackage'], {stdio: 'inherit', shell: true}).on('close', resolve);
    });
}

async function incrementVersion() {
    const version = package.version.split('-');
    const versionComponents = version[0].split('.');

    const minorVersion = (parseInt(versionComponents[2]) || 0) + 1;
    versionComponents[2] = minorVersion.toString();

    version[0] = versionComponents.join('.');
    
    package.version = version.join('-');
    console.log(`Increased version number to ${package.version}`);

    fs.writeFileSync('./package.json', JSON.stringify(package, undefined, '\t'));
}

/**
 * Authorizes the given request with either an app key, or a user/password combo
 * depending on which fields are defined in `package.json`
 * @param {request.Request} request 
 */
function authorizeRequest(request) {
    if (thingworxConnectionDetails.thingworxAppKey) {
        request.setHeader('appKey', thingworxConnectionDetails.thingworxAppKey);
    }
    else {
        request.auth(thingworxConnectionDetails.thingworxUser, thingworxConnectionDetails.thingworxPassword);
    }
}

async function clean() {
    await del('build');
}

async function build(cb) {
    //@ts-ignore
    twConfig.store = {};

    const project = ts.createProject('./tsconfig.json', {
        getCustomTransformers: (program) => ({
            before: [
                transformer.TWThingTransformerFactory(program, __dirname, false, false, twConfig)
            ],
            after: [
                transformer.TWThingTransformerFactory(program, __dirname, true, false, twConfig)
            ]
        })
    });

    // Prepare the transformers
    await new Promise(resolve => project.src().pipe(project()).dts.pipe(concat('index.d.ts')).pipe(dest('build/@types')).on('finish', resolve));

    // Write out the entity XML files
    // @ts-ignore
    for (const key in twConfig.store) {
        if (key == '@globalBlocks') continue;
        // @ts-ignore
        const entity = twConfig.store[key];
        entity.write();
    }

    // If project entity generation is enabled, create the project entity
    if (twConfig.generateProjectEntity) {
        const builder = new xml2js.Builder();
        const dependencies = {extensions: '', projects: ''};

        if (twConfig.includeProjectDependencies) {
            dependencies.extensions = (twConfig.extensionDependencies || []).join(',');
            dependencies.projects = (twConfig.projectDependencies || []).join(',');
        }

        const projectEntity = {
            Entities: {
                Projects: [
                    {
                        Project: [
                            {
                                $: {
                                    artifactId: "",
                                    "aspect.projectType": "Component",
                                    dependsOn: JSON.stringify(dependencies),
                                    description: "",
                                    documentationContent: "",
                                    groupId: "",
                                    homeMashup: "",
                                    minPlatformVersion: "",
                                    name: twConfig.projectName,
                                    packageVersion: "1.0.0",
                                    projectName: twConfig.projectName,
                                    publishResult: "",
                                    state: "DRAFT",
                                    tags: "",
                                },
                            },
                        ],
                    },
                ],
            },
        };

        const projectXML = builder.buildObject(projectEntity);
        
        if (!fs.existsSync(`build`)) fs.mkdirSync(`build`);
        if (!fs.existsSync(`build/Entities`)) fs.mkdirSync(`build/Entities`);
        if (!fs.existsSync(`build/Entities/Projects`)) fs.mkdirSync(`build/Entities/Projects`);

        fs.writeFileSync('build/Entities/Projects/Project.xml', projectXML);
    }

    // Copy and update the metadata file
    const metadataPath = isCombinedBuild ? './build/zip/metadata.xml' : './metadata.xml';
    const metadataFile = await new Promise(resolve => fs.readFile(metadataPath, 'utf8', (err, data) => resolve(data)));
    const metadataXML = await new Promise(resolve => xml2js.parseString(metadataFile, (err, result) => resolve(result)));

    const extensionPackage = metadataXML.Entities.ExtensionPackages[0].ExtensionPackage[0];
    extensionPackage.$.name = package.packageName;
    extensionPackage.$.packageVersion = package.version.split('-')[0];
    extensionPackage.$.description = package.description;
    extensionPackage.$.buildNumber = JSON.stringify({giteaURL: package.autoUpdate.gitHubURL});

    const builder = new xml2js.Builder();
    const outXML = builder.buildObject(metadataXML);

    fs.writeFileSync('build/metadata.xml', outXML);

    if (twConfig.experimentalGlobals) {
        console.log('\x1b[1m\n\n🛑🛑🛑 Experimental support for global code is enabled.\n\nMake sure you understand the risks involved before using this feature and be aware the support is likely to break in future versions of Thingworx.\n\n\x1b[0m');
    }

    cb();
}

async function merge() {
    const promises = [];
    promises.push(new Promise(resolve => src('build/@types/**').pipe(dest('build/zip/@types').on('end', resolve))));
    promises.push(new Promise(resolve => src('build/Entities/**').pipe(dest('build/zip/Entities').on('end', resolve))));
    promises.push(new Promise(resolve => src('build/metadata.xml').pipe(dest('build/zip').on('end', resolve))));

    await Promise.all(promises);
}

async function zip() {
    await del('zip');

    const srcFolder = isCombinedBuild ? 'build/zip/**' : 'build/**';

    // Create a zip of the build directory
    const zipStream = src(srcFolder)
        .pipe(gulpZip(zipName))
        .pipe(dest('zip'));

    await new Promise(resolve => zipStream.on('end', resolve));
}

/**
 * Generates and writes out the Thingworx declarations to `/static/gen/Generated.d.ts`.
 * This makes it possible to use syntax like `ThingTemplates.GenericThing.GetImplementingThings()`.
 */
async function buildDeclarations() {
    //@ts-ignore
    twConfig.store = {};

    const project = ts.createProject('./tsconfig.json', {
        getCustomTransformers: (program) => ({
            before: [
                transformer.TWThingTransformerFactory(program, __dirname, false, true, twConfig)
            ]
        })
    });

    // Prepare the transformers
    await new Promise(resolve => project.src().pipe(project()).on('finish', resolve).on('error', resolve));

    // Write out the entity XML files
    let definition = '';
    // @ts-ignore
    for (const key in twConfig.store) {
        if (key == '@globalBlocks') continue;
        // @ts-ignore
        const entity = twConfig.store[key];
        definition += `\n${entity.toDefinition()}\n`;
    }

    if (!fs.existsSync('static/gen')) fs.mkdirSync('static/gen');
    fs.writeFileSync('static/gen/Generated.d.ts', definition);
}

/**
 * Starts a watch process that generates Thingworx declarations whenever any source file is changed.
 */
async function gen() {
    return watch('src/**/*.ts', buildDeclarations);
}

async function upload() {
    const host = thingworxConnectionDetails.thingworxServer;

    console.log(`Uploading to ${thingworxConnectionDetails.thingworxServer}...`);

    return new Promise((resolve, reject) => {
        // load the file from the zip folder
        let formData = {
            file: fs.createReadStream(
                path.join('zip', zipName)
            )
        };
        // POST request to the ExtensionPackageUploader servlet
        const twRequest = request.post(
                {
                    url: `${host}/Thingworx/ExtensionPackageUploader?purpose=import`,
                    headers: {
                        'X-XSRF-TOKEN': 'TWX-XSRF-TOKEN-VALUE',
                        'Accept':'application/json'
                    },
                    formData: formData
                },
                function (err, httpResponse, body) {
                    if (err) {
                        console.error("Failed to upload project to thingworx");
                        reject(err);
                        return;
                    }
                    if (httpResponse.statusCode != 200) {
                        reject(`Failed to upload project to thingworx. We got status code ${httpResponse.statusCode} (${httpResponse.statusMessage})
body:
${httpResponse.body}`);
                    } else {
                        console.log(`Uploaded project version ${package.version} to Thingworx!`);
                        console.log(body);
                        resolve();
                    }
                }
            );

        authorizeRequest(twRequest);

    })
}

async function deploy() {
    // Discover any deployment endpoints and invoke them one by one
    let deploymentEndpoints = [];

    // @ts-ignore
    for (const key in twConfig.store) {
        if (key == '@globalBlocks') continue;
        // @ts-ignore
        const entity = twConfig.store[key];
        
        if (entity.deploymentEndpoints?.length) {
            deploymentEndpoints = deploymentEndpoints.concat(entity.deploymentEndpoints);
        }
    }

    const host = thingworxConnectionDetails.thingworxServer;

    for (const endpoint of deploymentEndpoints) {
        await new Promise((resolve, reject) => {
            console.log(`Running deployment script "${endpoint}...`);
            const twRequest = request.post(
                {
                    url: `${host}/Thingworx/${endpoint}`,
                    headers: {
                        'X-XSRF-TOKEN': 'TWX-XSRF-TOKEN-VALUE',
                        'Accept':'application/json',
                        'Content-Type': 'application/json'
                    }
                },
                function (err, httpResponse, body) {
                    if (err) {
                        console.error(`Deployment script "${endpoint}" failed:`);
                        reject(err);
                        return;
                    }
                    if (httpResponse.statusCode != 200) {
                        reject(`Deployment script "${endpoint}" failed with status code ${httpResponse.statusCode} (${httpResponse.statusMessage})
    body:
    ${httpResponse.body}`);
                    } else {
                        resolve();
                    }
                }
            );

            authorizeRequest(twRequest);
        });
    }
}

exports.buildJava = series(clean, buildJava, zip);
exports.buildDeclarations = series(buildDeclarations);
exports.build = series(buildDeclarations, clean, buildJava, build, merge, zip);
exports.buildJs = series(buildDeclarations, clean, build, zip);
exports.upload = series(buildDeclarations, incrementVersion, clean, buildJava, build, merge, zip, upload);
exports.uploadJs = series(buildDeclarations, incrementVersion, clean, build, zip, upload);
exports.deploy = series(buildDeclarations, incrementVersion, clean, build, zip, upload, deploy);
exports.default = series(gen);