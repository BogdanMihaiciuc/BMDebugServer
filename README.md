# Intro

A thingworx extension that allows debugging typescript projects created using [ThingworxVSCodeProject](https://github.com/BogdanMihaiciuc/ThingworxVSCodeProject) through Visual Studio Code's debugger UI.

Supporting common debugger features such as setting breakpoints, stepping through code, pausing on exceptions and evaluating expressions, this can significantly reduce the time it takes to fix bugs. This is especially important considering that script errors in thingworx often don't really include any information about what went wrong, even in the script log.

**🖐 NOTE: This extension should only be installed on a local development server.** 

The extension creates a debug thing that exposes a lot of information about your running services that is available via the regular Thingworx endpoints. Additionally, it will negatively impact the performance of your Thingworx server.

# How to use

The first step is to install this extension. You can either download the latest release and install it directly or build it from this repo. You may be prompted to restart the Thingworx server after installing - do so.

The extension creates a `BMObservingDebugger` subsystem, which must be started in order to be able to debug. By default, this subsystem may be disabled. To enable and start it, go to it using the composer, select the `Enabled`, save, then start it. Optionally, if you may also select the `Auto Start` checkbox to cause this subsystem to run on server startup.
 * **NOTE: Enabling this susbsystem will cause ALL newly created services to run interpreted mode which will impact performance.** This will also open a websocket endpoint at `/Thingworx/ThingworxDebugger` that is used to notify the frontend of important events, such as a thread stopping at a breakpoint.

After the subsystem starts, you will need to redeploy your typescript project, built with the `--debug` flag. For more information, see [ThingworxVSCodeProject](https://github.com/BogdanMihaiciuc/ThingworxVSCodeProject) and [ThingworxVSCodeDebugger](https://github.com/BogdanMihaiciuc/ThingworxVSCodeDebugger).

At this point, you may attach the Visual Studio Code debugger to thingworx and start debugging.

# Development

## Pre-Requisites

The following software is required:

* [NodeJS](https://nodejs.org/en/): needs to be installed and added to the `PATH`. You should use the LTS version (v14+).
* [JDK](https://www.oracle.com/java/technologies/downloads/) needs to be installed and added to the `PATH`.
* [gulp command line utility](https://gulpjs.com/docs/en/getting-started/quick-start): is needed to run the build script.

The following software is recommended:

* [Visual Studio Code](https://code.visualstudio.com/): An integrated developer enviroment with great javascript and typescript support. You can also use any IDE of your liking, it just that most of the testing was done using VSCode.

The java libraries are also required to be able to build the java extension. They should go in the `lib` folder:
* Thingworx Extension SDK - obtain this from PTC support
* `tomcat-api`, `tomcat-websocket` and `websocket-api` - obtain these from your local tomcat installation
* `thingworx-common`, `thingworx-platform-common` and `rhino` - obtain these from your local thingworx installation

## Build

To build the extension, run `gulp build` in the root of the project. This will generate an extension .zip file in the zip folder in the root of the project.

To build the extension and upload it to Thingworx, run `gulp upload` in the root of the project. The details of the Thingworx server to which the script will upload the extension are declared in the project's `package.json` file. These are:
 * `thingworxServer` - The server to which the extension will be uploaded.
 * `thingworxAppKey` or `thingworxUser` and `thingworxPassword` - The credentials used for uploading. This should be a user that has permission to install extensions.

This project combines two different extensions that are built and merged together. However, they can also be built and packaged independently from eachother:
 * To build the java extension run `gulp buildJava`
 * To build the javascript extension run `gulp buildJs`


## Deployment

Deployment to Thingworx is part of the build process as explained above. Alternatively, you can manually install the extension that is generated in the zip folder in the root of the project.

# Disclaimer

**🖐 You should only install this on a local server used for development.**

The BMDebugServer is not an official Thingworx product. It is something developed to improve the life of a Thingworx developer and they need to understand that it is not supported and any issues encountered are their own responsibility.

# License

[MIT License](LICENSE)
