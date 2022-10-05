"use BMDebugServer";

declare const me: any;

declare function getClass(name: string): any;

interface Dictionary<V> {
    [key: string]: V;
}

interface SparseArray<V> {
    [key: number]: V;
}

/**
 * Class helper used for instantiating Java classes.
 */
// const _class = (DataShapes.GenericStringList.CreateValuesWithData({values: {item: 'test'} as any}) as any).rows.class;

// const _context = _class.forName('org.mozilla.javascript.Context').getDeclaredMethod('getCurrentContext').invoke(null);
// const _x = _context.initStandardObjects(this);
const _x = Subsystems.BMObservingDebugger.InitStandardObjects();

/**
 * A lock that is used to synchronize access to thread information.
 */
const _threadLock: Lock = new Packages.java.util.concurrent.locks.ReentrantLock;

/**
 * A decorator that can be applied to a method to make it synchronized in a multi-threaded environment.
 * @param lock          A lock that should be acquired prior to executing the method, and released when it returns.
 * @returns             A decorator that may be applied to a class method.
 */
function _synchronized(lock: Lock): (object: Object, key: string, descriptor?: TypedPropertyDescriptor<(...args: any[]) => any>) => void {
    return function(object: Object, key: string, descriptor?: TypedPropertyDescriptor<(...args: any[]) => any>) {
        const method = descriptor!.value;
        descriptor!.value = function (...args: any[]): any {
            try {
                lock.lock();
                return method!.apply(this, args);
            }
            finally {
                lock.unlock();
            }
        }
    }
}

interface Subsystems {
    BMObservingDebugger: any;
}

/**
 * Constants that describe the kind of scopes within a service scope stack.
 */
enum BMDebuggerScopeKind {

    /**
     * Indicates that the scope is a restricted debugger scope.
     */
    Restricted,

    /**
     * Indicates that the scope is part of the service.
     */
    Service
}

/**
 * Constants that describe the reason why a thread was suspended by the debugger runtime.
 */
enum BMDebuggerSuspendReason {

    /**
     * Indicates that the thread was suspended because an active breakpoint was encountered.
     * When this reason is provided, the second argument must be the breakpoint that was triggered.
     */
    Breakpoint,

    /**
     * Indicates that the thread was suspended because of a throw statement.
     * When this reason is provided, the second argument must be the object that was thrown.
     */
    Exception,

    /**
     * Indicates that the thread was suspended because a command was sent to the debugger runtime.
     * When this reason is provided, the second argument must be the command that was issued.
     */
    Command,

    /**
     * Indicates that the thread was suspended because the suspend command was sent to the debugger.
     * When this reason is provided, the arguments array will be empty.
     */
    Requested,
}

/**
 * An enum that describes the kinds of commands that may be sent to a debugger.
 */
enum BMDebuggerCommandKind {

    /**
     * A command that causes the debugger to attempt to suspend the current thread.
     */
    Suspend = 'Suspend',

    /**
     * A command that causes the debugger to resume execution if suspended.
     */
    Resume = 'Resume',

    /**
     * A command that causes the debugger to resume execution until the next line where a pause is possible in the current function.
     */
    Step = 'Step Over',

    /**
     * A command that causes the debugger to resume execution until the next line where a pause is possible,
     * attempting to pause if a function is invoked.
     */
    StepIn = 'Step In',

    /**
     * A command that causes the debugger to resume execution until the current function returns, then pause again.
     */
    StepOut = 'Step Out',

    /**
     * A command that causes the debugger to evaluate an expression, save its result and signal a thread.
     */
    Evaluate = 'Evaluate',
}

/**
 * A class that manages debug related tasks such as pausing and resuming threads, 
 * extracting scope variables and more.
 */
class BMDebuggerRuntime {

    /**
     * Gets the value of a private field from a java object.
     * @param object        The object.
     * @param key           The name of the private field to get.
     */
    private static getPrivateField(object, key): any {
        const getClass = Packages.java.lang.Class.forName('java.lang.Object').getDeclaredMethod('getClass');

        const field = getClass.invoke(object).getField(key);
        field.setAccessible(true);
        return field.get(object);
    }

    /**
     * A reference to the `getParentScope` function defined on the `Scriptable` class.
     */
    private static _getParentScope = Packages.com.bogdanmihaiciuc.debugger.BMObservingDebugger.getParentScopeMethod()

    /**
     * A reference to the Thing class.
     */
    private static _thingClass = Packages.java.lang.Class.forName('com.thingworx.things.Thing');

    /**
     * A reference to the Root Entity class.
     */
    private static _rootEntityClass = Packages.java.lang.Class.forName('com.thingworx.entities.RootEntity');

    /**
     * A reference to the observing debugegr class, used to access types and methods that are no longer safe in
     * Thingworx 9.3.4 and later.
     */
    private static _observingDebuggerClass = Packages.com.bogdanmihaiciuc.debugger.BMObservingDebugger;

    /**
     * A reference to the scriptable object class, used to dermine if references are native javascript objects.
     */
    // private static _scriptableObjectClass = Packages.com.bogdanmihaiciuc.debugger.BMObservingDebugger.scriptableObjectClass();
    //Packages.java.lang.Class.forName('org.mozilla.javascript.ScriptableObject');

    /**
     * A reference to the java getClass method, used for retrieving the underlying class of objects.
     */
    private static _getClass = Packages.java.lang.Class.forName('java.lang.Object').getMethod('getClass');

    /**
     * Returns the type name of the given java class.
     * @param c         The class.
     * @returns         The name.
     */
    private static _typeNameOfJavaClass(c: any): string {
        const components = c.getName().split('.');
        return components[components.length - 1];
    }

    /**
     * An array that contains the active threads that are currently running services
     * that may be debugged.
     */
    private static _activeDebuggers: BMDebuggerRuntime[] = [];

    /**
     * The number of connected debuggers.
     */
    private static _connectedDebuggers = 0;

    /**
     * Must be invoked by a debugger when it connects.
     */
    @_synchronized(_threadLock)
    static connectDebugger(): void {
        this._connectedDebuggers++;
    }

    /**
     * Must be invoked by a debugger when it disconnects.
     */
    @_synchronized(_threadLock)
    static disconnectDebugger(): void {
        if (this._connectedDebuggers) {
            this._connectedDebuggers--;
        }

        // When there are no more connected debuggers, clear all breakpoints
        // and resume all suspended threads
        if (!this._connectedDebuggers) {

            // Deactivate all breakpoints
            for (const key in this._allBreakpoints) {
                const breakpoint = this._allBreakpoints[key];
                breakpoint.active = false;
                breakpoint.verified = false;
                breakpoint.condition = undefined;
            }

            // Disable break on exception
            this.breaksOnException = false;

            // Resume all suspended threads
            this._activeDebuggers.forEach(runtime => {
                if (runtime._isSuspended) {
                    runtime.resume();
                }
            });
        }
    }

    /**
     * Returns an array containing information about the threads that are currently running
     * services that may be debugged.
     * @returns     An array of thread information objects.
     */
    @_synchronized(_threadLock)
    static activeDebuggers(): BMDebuggerRuntime[] {
        return this._activeDebuggers.slice();
    }

    /**
     * Marks the given debugger as active and keeps track of it.
     * @param _debugger     The debugger to activate.
     */
    @_synchronized(_threadLock)
    private static _activateDebugger(_debugger: BMDebuggerRuntime): void {
        this._activeDebuggers.push(_debugger);
    }

    /**
     * Marks the given debugger as inactive.
     * @param _debugger     The debugger to activate.
     */
    @_synchronized(_threadLock)
    private static _deactivateDebugger(_debugger: BMDebuggerRuntime): void {
        const index = this._activeDebuggers.findIndex(d => d == _debugger);
        if (index != -1) {
            this._activeDebuggers.splice(index, 1);
        }

        if (this.avoidReuse) {
            this._localDebuggers.set(null as any);
        }

        // When there are no more active debug threads, clear out the variable references
        if (!this._activeDebuggers.length) {
            this._clearObjectIDMaps();
        }
    }

    /**
     * A dictionary that contains the active breakpoints that have been set. Its keys represent
     * filenames and its values are sparse arrays where the indexes are the activated line numbers.
     */
    private static _breakpoints: Dictionary<SparseArray<SparseArray<BMDebuggerBreakpoint>>> = {};

    /**
     * A sparse array containing the breakpoints in all source files that is used for fast lookup
     * via the breakpoint's id.
     */
    private static _allBreakpoints: Dictionary<BMDebuggerBreakpoint> = {};

    /**
     * A `ThreadLocal` that contains the instance of the debuggers to be used for each thread.
     */
    private static _localDebuggers: ThreadLocal<BMDebuggerRuntime> = new Packages.java.lang.ThreadLocal;

    /**
     * For development only.
     */
    static avoidReuse = true;

    /**
     * Returns the debugger associated with the current thread. If one doesn't already
     * exist, a new one is created.
     * @returns     A debugger.
     */
    static localDebugger(): BMDebuggerRuntime {
        let server = this._localDebuggers.get();

        // Don't reuse runtimes while developing
        if (!server?._retainCount && this.avoidReuse) {
            server = null;
        }

        if (!server) {
            server = new BMDebuggerRuntime();
            server._init();
            this._localDebuggers.set(server);
        }

        return server;
    }

    /**
     * Returns the debugger for the given thread.
     * @param id    The id of the thread for which to retrieve the debugger.
     * @returns     A debugger if it could be found, `undefined` otherwise.
     */
    @_synchronized(_threadLock)
    static debuggerForThread(id: number): BMDebuggerRuntime | undefined {
        return this._activeDebuggers.find(d => d._thread.getId() == id);
    }

    /**
     * Should be set to `true` to cause the debugger runtimes to automatically suspend whenever
     * any exception is thrown.
     */
    static breaksOnException = false;

    /**
     * Returns a breakpoint initialized from the given breakpoint location.
     * @param location          The breakpoint location.
     * @param file              The file in which the breakpoint should be located.
     * @returns                 A breakpoint.
     */
    private static _debuggerBreakpointWithLocation(location: BMDebuggerBreakpointLocation, file: string): BMDebuggerBreakpoint {
        return {
            line: location.line,
            column: location.column,
            endLine: location.endLine,
            endColumn: location.endColumn,
            active: false,
            id: location.locationID,
            sourceFile: file,
            verified: false
        };
    }

    /**
     * Loads the debug information contained in the given debug information entity.
     * @param name      The name of the entity containing the debug information.
     */
    static registerExtensionPackage(name: string): void {
        const self = this;

        // Get the debug entity
        const debugEntity = Things[name];
        if (!debugEntity) return;

        let debugInformation;
        try {
            debugInformation = JSON.parse(debugEntity.debugInformation);
        }
        catch (e) {
            return;
        }

        // When configuration tables are inherited, the same file will appear multiple times with the same
        // breakpoint locations, so it doens't make sense to process it multiple times
        const processedFiles: Dictionary<boolean> = {};

        Object.keys(debugInformation).forEach(function (file: string) {
            if (processedFiles[file]) return;
            processedFiles[file] = true;

            const breakpoints = debugInformation[file];
            
            // Attempt to keep the active breakpoints active
            const currentBreakpoints = self._breakpoints[file];

            self._breakpoints[file] = {};
            breakpoints.forEach(function (breakpoint) {
                const newBrekpoint = self._debuggerBreakpointWithLocation(breakpoint, file);
                self._breakpoints[file][breakpoint.line] ||= {};
                self._breakpoints[file][breakpoint.line][breakpoint.column!] = newBrekpoint;

                // If a previous breakpoint already existed at this line and column, copy its active, verified and condition properties
                const oldObreakpoint = currentBreakpoints?.[breakpoint.line]?.[breakpoint.column];
                if (oldObreakpoint) {
                    newBrekpoint.active = oldObreakpoint.active;
                    newBrekpoint.verified = oldObreakpoint.verified;
                    newBrekpoint.condition = oldObreakpoint.condition;
                }
            });
        });

        this._rebuildAllBreakpointsList();
    }

    /**
     * A sequence number that is used to assign the sequence ID to breakpoints.
     */
    private static _sequenceID = 0;

    /**
     * Flattens the tree of breakpoints into a single map indexed by their id. This modifies the `_allBreakpoints` property.
     */
    private static _rebuildAllBreakpointsList() {
        this._allBreakpoints = {};
        for (const file of Object.keys(this._breakpoints)) {
            for (const row of Object.keys(this._breakpoints[file])) {
                for (const column of Object.keys(this._breakpoints[file][row])) {
                    const breakpoint = this._breakpoints[file][row][column] as BMDebuggerBreakpoint;

                    this._sequenceID++;
                    breakpoint.sequenceID = this._sequenceID;

                    this._allBreakpoints[breakpoint.id] = breakpoint;
                }
            }
        }
    }

    /**
     * Returns an array that contains all known breakpoint locations across all files.
     * @returns     An array of breakpoint locations.
     */
    static allBreakpointLocations(): Struct<BMDebuggerBreakpointLocation>[] {
        const self = this;
        return Object.keys(this._allBreakpoints).map(function(key) {
            const breakpoint = self._allBreakpoints[key];
            return {
                locationID: breakpoint.id,
                line: breakpoint.line,
                column: breakpoint.column,
                endLine: breakpoint.endLine,
                endColumn: breakpoint.endColumn,
                fileName: breakpoint.sourceFile
            } as Struct<BMDebuggerBreakpointLocation>;
        });
    }

    /**
     * Activates the given list of breakpoints in the specified file.
     * @param path              The file in which the breakpoints are set.
     * @param breakpoints       The breakpoints which should be activated.
     * @returns                 An array describing the breakpoints that have been activated.
     */
    static setBreakpoints(path: string, breakpoints: BMDebuggerSourceBreakpoint[]): Partial<Struct<BMDebuggerBreakpointResponse>>[] {
        const result: Partial<Struct<BMDebuggerBreakpointResponse>>[] = [];

        // Clear out all the breakpoints at the given path
        const file = this._breakpoints[path];
        if (!file) return result;
        for (const row of Object.keys(file)) {
            for (const column of Object.keys(file[row])) {
                const breakpoint = file[row][column] as BMDebuggerBreakpoint;
                breakpoint.active = false;
                breakpoint.condition = undefined;
                breakpoint.verified = false;
            }
        }

        // The attempt to verify each breakpoint in the request
        for (const breakpoint of breakpoints) {
            const columns = file[breakpoint.line];
            if (columns) {
                let targetBreakpoint: BMDebuggerBreakpoint;

                if (!breakpoint.column) {
                    // If no column is specified in the request, activate the first column
                    targetBreakpoint = columns[Object.keys(columns)[0]];
                }
                else {
                    // Otherwise attempt to get the requested column
                    targetBreakpoint = columns[breakpoint.column];
                }

                if (targetBreakpoint) {
                    // If a breakpoint was found, activate it and add it to the response
                    targetBreakpoint.active = true;
                    targetBreakpoint.verified = true;
                    targetBreakpoint.condition = breakpoint.condition;

                    const verifiedBreakpoint: Partial<Struct<BMDebuggerBreakpointResponse>> = {
                        line: targetBreakpoint.line,
                        column: targetBreakpoint.column,
                        endColumn: targetBreakpoint.endColumn,
                        endLine: targetBreakpoint.endLine,
                        locationID: targetBreakpoint.id,
                        sequenceID: targetBreakpoint.sequenceID,
                        source: path,
                        verified: true
                    };

                    result.push(verifiedBreakpoint);
                    continue;
                }
            }

            // If no breakpoint could be activated, add a synthetic unverified breakpoint to the response
            const unverifiedBreakpoint: Partial<Struct<BMDebuggerBreakpointResponse>> = {
                line: breakpoint.line,
                column: breakpoint.column,
                verified: false,
                source: path,
                message: 'The debugger cannot suspend at this location.'
            };

            result.push(unverifiedBreakpoint);
        }

        return result;
    }

    /**
     * The thread for this debug server.
     */
    private _thread: any;

    /**
     * Returns the thread ID for this runtime's thread. This property may be accessed from any thread.
     * @returns     The thread ID.
     */
    threadID(): number {
        return this._thread.getId();
    }

    /**
     * A lock that is used to suspend this debugger's thread.
     */
    private _suspendLock!: Lock;

    /**
     * A condition that is used to await for a new command while the thread is suspended.
     */
    private _commandCondition!: Condition;

    /**
     * Initializes this debugger for the current thread.
     */
    private _init(): void {
        this._thread = Packages.java.lang.Thread.currentThread();

        this._suspendLock = new Packages.java.util.concurrent.locks.ReentrantLock;
        this._commandCondition = this._suspendLock.newCondition();
        this.self = this;
    }

    /**
     * Sends a log message to the debugger.
     * @param message       The message.
     * @param level         The log level.
     */
    static sendLogMessage(message: string, level: number): void {
        const logMessage = JSON.stringify({name: 'log', body: message, level: level} as BMDebuggerLogMessage);
        try {
            Subsystems.BMObservingDebugger.SendMessage({message: logMessage});
        }
        catch (e) {

        }
    }

    /**
     * Returns a logger that will send log messages to the debugger,
     * in addition to the standard output.
     * @returns     A logger.
     */
    getLogger(): typeof logger {
        const self = this;
        return {
            trace: (message, args) => logger.trace(message, args),
            info: (message, args) => {
                BMDebuggerRuntime.sendLogMessage(message, 0);
                logger.info(message, args);
            },
            debug: (message, args) => {
                BMDebuggerRuntime.sendLogMessage(message, 1);
                logger.debug(message, args);
            },
            warn: (message, args) => {
                BMDebuggerRuntime.sendLogMessage(message, 2);
                logger.warn(message, args);
            },
            error: (message, args) => {
                BMDebuggerRuntime.sendLogMessage(message, 3);
                logger.error(message, args);
            }
        }
    }

    /**
     * A counter that keeps track of how many nested service calls are using this debugger instance.
     */
    private _retainCount = 0;

    /**
     * A reference to self that is useful to identify this debugger runtime when its metods
     * are invoked via a proxy object. 
     */
    private self!: BMDebuggerRuntime;

    /**
     * A stack containing information about the currently executing services.
     */
    private serviceStack: BMDebuggerService[] = [];

    /**
     * The last entry in the service stack.
     */
    private get currentService(): BMDebuggerService | undefined {
        return this.serviceStack[this.serviceStack.length - 1];
    }

    /**
     * The last non-restricted entry in the current service's scope stack.
     */
    private get currentScope(): BMDebuggerServiceScope | undefined {
        const service = this.currentService;
        const length = service?.scopeStack.length || 0;
        for (let i = length - 1; i >= 0; i--) {
            const scope = service!.scopeStack[i];
            if (scope.kind == BMDebuggerScopeKind.Service) {
                return scope;
            }
        }
    }

    /**
     * Must be invoked at the start of any debuggable service.
     * Incerements this debugger's retain count and makes information about
     * this thread available in the debug server.
     * 
     * This must only be invoked from this runtime's thread.
     */
    retainForService(service: BMDebuggerService) {
        // If there is already a service in the stack, the last frame will contain this service's global frame
        // which isn't useful for debugging, as all the typescript code runs from an iife
        if (this.currentService) {
            const scope: any = this.currentScope;
            if (scope) {
                scope.kind = BMDebuggerScopeKind.Restricted;
            }
        }

        this.serviceStack.push({
            column: 0,
            line: 0,
            filename: service.filename,
            name: service.name,
            scopeStack: [{kind: BMDebuggerScopeKind.Restricted}]
        });

        if (!this._retainCount) {
            BMDebuggerRuntime._activateDebugger(this);

            const frames = BMDebuggerRuntime.getPrivateField(Subsystems.BMObservingDebugger, 'frames');
            const self = this;
            const frame = frames.get();
            
            if (frame) {
                // Frame can be undefined when the debugger is disabled, or the services being debugged
                // aren't running in interpreted mode
                frame.delegate = new Packages.org.mozilla.javascript.debug.DebugFrame({
                    onEnter(a, b, c, d) { self.onEnter(a, b, c, d); },
    
                    onExit(a, b, c) { self.onExit(a, b, c); },
    
                    onDebuggerStatement(a) {},
    
                    onLineChange(a, b) {},
    
                    onExceptionThrown(a, b) { self.onExceptionThrown(a, b); }
                });
            }
        }

        this._retainCount++;
    }

    /**
     * Must be invoked at the end of any debuggable service.
     * Decrements this debugger's retain count and if there are no more services
     * using this debugger, disposes of it.
     * 
     * This must only be invoked from this runtime's thread.
     */
    release() {
        this._retainCount--;

        this.serviceStack.pop();

        if (!this._retainCount) {
            BMDebuggerRuntime._deactivateDebugger(this);

            const frames = BMDebuggerRuntime.getPrivateField(Subsystems.BMObservingDebugger, 'frames');
            const frame = frames.get();
            if (frame) {
                frame.delegate = null;
            }
        }
    }

    /**
     * An incrementing number used to keep track of scopes.
     */
    private static _scopeIndex: number = 0;

    /**
     * Set to `true` while evaluating an expression. Prevents breakpoints from being triggered during the evaluation.
     */
    private _isEvaluatingExpression = false;
    
    /**
     * Invoked when any new scope is entered.
     * @param context       The rhino context.
     * @param activation    The activation object.
     * @param thisObj       The function's context object.
     * @param args          The function's arguments.
     */
    private onEnter(context: any, activation: any, thisObj: any, args: any[]) {
        // The current service will be undefined for the first entry when invoking a service
        const self = this.self;
        if (!self || !self.currentService) {
            return;
        }

        if (self._isEvaluatingExpression) return;

        const currentService = self.currentService;

        // NOTE: For restricted scopes, no commands are executed
        if (thisObj == this.self) {
            currentService.scopeStack.push({kind: BMDebuggerScopeKind.Restricted});
        }
        else if (thisObj == BMDebuggerRuntime) {
            currentService.scopeStack.push({kind: BMDebuggerScopeKind.Restricted});
        }
        else {
            let name = currentService.name + (currentService.scopeStack.length ? ' - <anonymous>' : '');
            try {
                const nativeCallType = Packages.java.lang.Class.forName('org.mozilla.javascript.NativeCall');

                if (nativeCallType.isInstance(activation)) {
                    // If the activation object is a native call, try to get the function's name
                    const functionField = nativeCallType.getDeclaredField('function');
                    functionField.setAccessible(true);
                    const fn = functionField.get(activation);
    
                    if (fn) {
                        const getNameMethod = Packages.java.lang.Class.forName('org.mozilla.javascript.NativeFunction').getMethod('getFunctionName');
                        name = currentService.name + ' - ' + (getNameMethod.invoke(fn) || '<anonymous>');
                    }
                }
            }
            catch (e) {
                logger.error(e as any);
            }

            try {
                _threadLock.lock();
                currentService.scopeStack.push({
                    kind: BMDebuggerScopeKind.Service, 
                    activationObject: activation, 
                    contextObject: thisObj, 
                    arguments: args,
                    id: BMDebuggerRuntime._scopeIndex,
                    name,
                    line: 0,
                    column: 0
                });
    
                BMDebuggerRuntime._scopeIndex++;
            }
            finally {
                _threadLock.unlock();
            }

            // If the current command is to step in, pause as soon as possible
            if (self._command?.kind == BMDebuggerCommandKind.StepIn) {
                self._command = {
                    kind: BMDebuggerCommandKind.Suspend,
                    reason: BMDebuggerSuspendReason.Command,
                    args: [self._command]
                } as BMDebuggerSuspendCommand;
            }
        }
    }

    private onLineChange(context: any, line: number) {
        // This is not invoked, instead several checkpoints are generated by the thing transformer
        // whch enable breakpoints and stepping
    }

    /**
     * Set to `true` when the runtime throws an exception to obtain the stack trace.
     */
    private _isSyntheticException = false;

    /**
     * Set to the thrown value when this thread stops due to an exception.
     */
    private _exception?: any;

    /**
     * Invoked when any throwable is thrown.
     * @param context       The rhino context.
     * @param throwable     The throwable that was thrown.
     */
    private onExceptionThrown(context: any, throwable: any) {
        // Don't process evaluation events
        if (this._isEvaluatingExpression) return;

        // Don't process sythetic exceptions
        if (this._isSyntheticException) return;

        // Suspend if break on exception is enabled
        if (BMDebuggerRuntime.breaksOnException) {
            this._suspend(BMDebuggerSuspendReason.Exception, throwable);
        }
    }

    /**
     * Invoked when any scope is exited.
     * @param context   The rhino context.
     * @param thrown    `true` if the scope was exited due to a `throw` statement.
     * @param result    The result, if the scope was existed via a `return` statement, the thrown object otherwise.
     */
    private onExit(context: any, thrown: boolean, result: any) {
        // Don't process evaluation events
        if (this._isEvaluatingExpression) return;

        const scope = this.currentService?.scopeStack?.pop();

        if (!scope || scope.kind == BMDebuggerScopeKind.Restricted) return;
        // If the current command is to step out and the scope is non-restricted
        // set the command to pause in order to suspend as soon as possible

        // Also pause if this a step over command in the exiting scope's activation object
        if (this._command?.kind == BMDebuggerCommandKind.StepOut || this._command?.kind == BMDebuggerCommandKind.Step) {
            const stepOutCommand = this._command as BMDebuggerStepOutCommand | BMDebuggerStepOverCommand;

            if (scope.activationObject == stepOutCommand.activationObject) {
                this._command = {
                    kind: BMDebuggerCommandKind.Suspend,
                    reason: BMDebuggerSuspendReason.Command,
                    args: [this._command]
                } as BMDebuggerSuspendCommand;
            }
        }
    }

    private onDebuggerStatement(context: any) {
        // This is not used currently
    }

    printActivationCall() {
        // void
        this.debugger();
    }

    /**
     * The next command to execute when possible.
     */
    private _command?: BMDebuggerCommand;

    /**
     * Executes the given command when possible.
     * @param command       The command to execute.
     */
    private _executeCommand(command: BMDebuggerCommand): void {
        this._suspendLock.lock();
        try {
            this._command = command;
            this._commandCondition.signal();
        }
        finally {
            this._suspendLock.unlock();
        }
    }

    /**
     * Issues a step over command. Has no effect if the thread isn't currently suspended.
     * This method may be invoked from any thread.
     */
    stepOver(): void {
        this._suspendLock.lock();
        try {
            if (!this._isSuspended) return;
            this._executeCommand({kind: BMDebuggerCommandKind.Step, activationObject: this.currentScope?.activationObject} as BMDebuggerStepOverCommand);
        }
        finally {
            this._suspendLock.unlock();
        }
    }

    /**
     * Issues a step out command. Has no effect if the thread isn't currently suspended.
     * This method may be invoked from any thread.
     */
    stepOut(): void {
        this._suspendLock.lock();
        try {
            if (!this._isSuspended) return;
            this._executeCommand({kind: BMDebuggerCommandKind.StepOut, activationObject: this.currentScope?.activationObject} as BMDebuggerStepOutCommand);
        }
        finally {
            this._suspendLock.unlock();
        }
    }

    /**
     * Issues a step in command. Has no effect if the thread isn't currently suspended.
     * This method may be invoked from any thread.
     */
    stepIn(): void {
        this._suspendLock.lock();
        try {
            if (!this._isSuspended) return;
            this._executeCommand({kind: BMDebuggerCommandKind.StepIn});
        }
        finally {
            this._suspendLock.unlock();
        }
    }

    /**
     * Issues a resume command. Has no effect if the thread isn't currently suspended.
     * This method may be invoked from any thread.
     */
    resume(): void {
        this._suspendLock.lock();
        try {
            if (!this._isSuspended) return;
            this._executeCommand({kind: BMDebuggerCommandKind.Resume});
        }
        finally {
            this._suspendLock.unlock();
        }
    }

    /**
     * Issues a suspend command. Has no effect if the thread is currently suspended.
     * This method may be invoked from any thread.
     */
    suspend(): void {
        this._suspendLock.lock();
        try {
            if (this._isSuspended) return;
            this._executeCommand({kind: BMDebuggerCommandKind.Suspend, reason: BMDebuggerSuspendReason.Requested, args: []} as BMDebuggerSuspendCommand);
        }
        finally {
            this._suspendLock.unlock();
        }
    }

    /**
     * Set to `true` while this thread is suspended.
     */
    private _isSuspended = false;

    /**
     * Checks whether this runtime's thread is suspended. This method may be invoked from any thread.
     */
    isSuspended(): boolean {
        this._suspendLock.lock();
        try {
            return this._isSuspended;
        }
        finally {
            this._suspendLock.unlock();
        }
    }

    /**
     * A string that describes the current suspesion reason.
     */
    private _suspensionReason?: string;

    /**
     * Gets the reason for which this thread was suspended. This method may be invoked from any thread.
     * @returns     A string describing the suspension reason if the thread is suspended, `undefined` otherwise.
     */
    suspensionReason(): string | undefined {
        this._suspendLock.lock();
        try {
            return this._suspensionReason;
        }
        finally {
            this._suspendLock.unlock();
        }
    }

    /**
     * While suspended, this represents the stack trace at the moment
     * when this thread was suspended.
     */
    private get _stackTrace(): BMDebuggerStackFrame[] {
        const frames: BMDebuggerStackFrame[] = [];

        for (const service of this.serviceStack) {
            // The first frame of all services always appears subdued, because
            // it is outside the function created by the transformer
            let firstFrame = true;

            for (const frame of service.scopeStack) {
                // Restricted frames are omitted from the response
                if (frame.kind != BMDebuggerScopeKind.Restricted) {
                    frames.unshift({
                        column: frame.column,
                        line: frame.line,
                        name: frame.name,
                        presentationHint: firstFrame ? 'label' : 'normal' as any,
                        source: service.filename,
                        id: frame.id,
                    });
                }

                firstFrame = false;
            }
        }

        return frames;
    }

    /**
     * Gets the stack trace at the moment when this thread was suspended. This method may be invoked from any thread.
     * @returns     A string containing the stack trace if the thread is suspended, `undefined` otherwise.
     */
    stackTrace(): BMDebuggerStackFrame[] | undefined {
        this._suspendLock.lock();
        try {
            return this._stackTrace;
        }
        finally {
            this._suspendLock.unlock();
        }
    }

    /**
     * An incrementing number used to keep track of variable containers.
     */
    private static _variablesIndex = 0;

    /**
     * A mapping between unique IDs and javascript objects.
     */
    private static _nativeObjectMap: HashMap<number, WeakReference<any>> = new Packages.java.util.HashMap();

    /**
     * A mapping between javascript objects and unique IDs.
     */
    private static _nativeObjectIDMap: HashMap<any, number> = new Packages.java.util.WeakHashMap();

    /**
     * Returns the unique ID for the given object. If the object has not been
     * assigned any ID previously, it is added to the ID maps using a newly created ID.
     * @param object        The object for which to retrieve the ID.
     * @returns             A unique ID for the given object.
     */
    @_synchronized(_threadLock)
    private static _IDForObject(object: any): number {
        if (BMDebuggerRuntime._nativeObjectIDMap.containsKey(object)) {
            return BMDebuggerRuntime._nativeObjectIDMap.get(object)!;
        }

        const ID = ++BMDebuggerRuntime._variablesIndex;
        BMDebuggerRuntime._nativeObjectMap.put(ID, new Packages.java.lang.ref.WeakReference(object));
        BMDebuggerRuntime._nativeObjectIDMap.put(object, ID);
        return ID;
    }

    /**
     * Clears out the object ID maps.
     */
    @_synchronized(_threadLock)
    private static _clearObjectIDMaps(): void {
        this._nativeObjectMap.clear();
        this._nativeObjectIDMap.clear();
    }

    /**
     * Returns the scopes for the frame with the given sequence ID. This must be invoked
     * from the debugger's thread.
     * @param sequenceID        The sequence ID of the stack frame.
     * @returns                 An array of scopes.
     */
    private _scopesForStackFrame(sequenceID: number): BMDebuggerScope[] {
        const scopes: BMDebuggerScope[] = [];

        // Find the stack frame with the given sequence ID
        let frame: BMDebuggerServiceScope | undefined;
        for (const service of this.serviceStack) {
            for (const serviceFrame of service.scopeStack) {
                if (serviceFrame.kind == BMDebuggerScopeKind.Service && serviceFrame.id == sequenceID) {
                    frame = serviceFrame;
                    break;
                }
            }

            if (frame) break;
        }

        if (!frame) return scopes;

        // Add an entry for each activation object
        let currentScope = frame.activationObject;
        let name = 'locals';
        while (currentScope) {
            const scopeID = BMDebuggerRuntime._IDForObject(currentScope);
            
            scopes.push({
                expensive: false,
                name,
                variablesReference: scopeID,
                namedVariables: Object.keys(currentScope).length + 1,
                indexedVariables: 0,
                presentationHint: 'locals'
            });

            // Other than the first activation object, all scopes will be named "closure"
            name = 'closure';
            currentScope = BMDebuggerRuntime._getParentScope.invoke(currentScope);
        }

        // Add the context object scope
        const thisID = BMDebuggerRuntime._IDForObject(frame.contextObject);

        // Unlike other scope members, the context object can be a non-javascript-native object
        const info = BMDebuggerRuntime._infoForObject(frame.contextObject);
        scopes.push({
            expensive: false, 
            name: 'this', 
            variablesReference: thisID, 
            namedVariables: info.namedVariables,
            indexedVariables: info.indexedVariables,
            presentationHint: 'locals'
        });

        // Add the arguments array, if it contains anything
        if (frame.arguments && frame.arguments.length) {
            const argsID = BMDebuggerRuntime._IDForObject(frame.arguments);
            
            scopes.push({
                expensive: false,
                name: 'arguments',
                variablesReference: argsID,
                namedVariables: 1, // This will only include the length
                indexedVariables: frame.arguments.length,
                presentationHint: 'locals'
            });
        }

        return scopes;
    }

    /**
     * Returns the contents of the given object.
     * @param object    The object whose contents should be retrieved.
     * @returns         An array of variables contained within the object.
     */
    private static _infoForObject(object: any, contents: true): BMDebuggerVariable[];

    /**
     * Returns information about the given variable.
     * @param object                The variable to obtain information about.
     * @param name                  If specified, the name to assign to the variable, otherwise the name
     *                              will be derived from the object's properties, when possible.
     * @param presentationHint      If specified, information about how this variable should be presented.
     *                              If omitted, the presentation details will depend on the object's type.
     * @return                      Details about the variable.
     */
    private static _infoForObject(object: any, name?: string, presentationHint?: BMDebuggerVariablePresentationHint): BMDebuggerVariable;
    
    private static _infoForObject(object: any, name?: any, presentationHint?: BMDebuggerVariablePresentationHint): BMDebuggerVariable | BMDebuggerVariable[] {
        const isContent = (typeof name == 'boolean');

        const defaultPresentationHint = {
            attributes: [],
            kind: 'property',
            visibility: 'public'
        };

        // Treat null and undefined at the beginning, as they will crash the 'getClass' call
        if (object === null) {
            if (isContent) return [];

            return {
                name: name || 'object',
                type: 'null',
                value: 'null',
                variablesReference: 0,
                presentationHint: presentationHint || defaultPresentationHint
            };
        }

        if (object === undefined) {
            if (isContent) return [];

            return {
                name: name || 'object',
                type: 'undefined',
                value: 'undefined',
                variablesReference: 0,
                presentationHint: presentationHint || defaultPresentationHint
            };
        }

        const javaClass = BMDebuggerRuntime._getClass.invoke(object);

        // Check first for entity types
        if (BMDebuggerRuntime._thingClass.isInstance(object)) {
            if (isContent) return this._contentOfThing(object);

            return {
                name: name || object.name,
                type: object.IsEnabled() ? object.thingTemplate : 'Thing (Disabled)',
                value: object.IsEnabled() ? 'Thing ' + object.name : 'Thing (Disabled)',
                variablesReference: this._IDForObject(object),
                indexedVariables: 0,
                namedVariables: (object.IsEnabled() ? object.GetPropertyDefinitions().length + object.GetLocallyImplementedShapes().length : 0) + 1,
                presentationHint: presentationHint || defaultPresentationHint
            }
        }
        else if (BMDebuggerRuntime._rootEntityClass.isInstance(object)) {
            if (isContent) return this._contentOfRootEntity(object);
            const metadata = object.GetMetadata();

            return {
                name: name || metadata.name,
                type: metadata.type,
                value: `${metadata.type} ${metadata.name}`,
                variablesReference: this._IDForObject(object),
                indexedVariables: 0,
                namedVariables: metadata.propertyDefinitions.length + metadata.serviceDefinitions.length + metadata.eventDefinitions.length,
                presentationHint: presentationHint || defaultPresentationHint
            }
        }

        // Names to be used for classes which are handled the same way
        // but have multiple implementations
        let JSONArrayName;
        let JSONObjectName;
        let InfoTableName;
        let ValueCollectionName;

        switch (javaClass) {
            // For boxed java types, treat them as javascript natives
            case Packages.java.lang.String:
                if (isContent) return [];
    
                return {
                    name: name || 'object',
                    type: object.constructor?.name || 'String',
                    value: JSON.stringify(object),
                    variablesReference: 0,
                    namedVariables: 0,
                    indexedVariables: 0,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            case Packages.java.lang.Double:
                if (isContent) return this._contentOfObject(object);
                return {
                    name: name || 'object',
                    type: object.constructor?.name || 'Number',
                    value: object.toString(),
                    variablesReference: 0,
                    namedVariables: 0,
                    indexedVariables: 0,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            case Packages.java.lang.Boolean:
                if (isContent) return this._contentOfObject(object);
                return {
                    name: name || 'object',
                    type: object.constructor?.name || 'Boolean',
                    value: object.toString(),
                    variablesReference: 0,
                    namedVariables: 0,
                    indexedVariables: 0,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            // Java classes
            case Packages.java.lang.Class:
                if (isContent) return this._contentOfClass(object);
                return {
                    name: name || 'object',
                    type: object.getName(),
                    value: `java class ${object.getName()}`,
                    variablesReference: this._IDForObject(object),
                    namedVariables: object.getDeclaredFields().length + object.getDeclaredMethods().length + 1,
                    indexedVariables: 0,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            case Packages.java.lang.reflect.Field:
                if (isContent) return [];
                return {
                    name: name || object.getName(),
                    type: object.getType().getName(),
                    value: object.getType().getName(),
                    variablesReference: 0,
                    namedVariables: 0,
                    indexedVariables: 0,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            case Packages.java.lang.reflect.Method:
                if (isContent) return [];
                return {
                    name: name || object.getName(),
                    type: 'method',
                    value: 'method',
                    variablesReference: 0,
                    namedVariables: 0,
                    indexedVariables: 0,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            // non-native JSON types
            case Packages.com.thingworx.dsl.engine.adapters.JSONObjectAdapter:
                JSONObjectName = 'JSONObjectAdapter';
            case Packages.org.json.JSONObject:
                if (isContent) return this._contentOfJSONObject(object);
                JSONObjectName = 'JSONObject';

                // For JSONObject, typical javascript methods like Object.keys do not work
                // So the the only way to get a count is to do a for loop through it
                let JSONVariables = 0;
                for (const key in object) {
                    JSONVariables++;
                }

                return {
                    name: name || 'object',
                    type: JSONObjectName,
                    value: JSONObjectName,
                    variablesReference: this._IDForObject(object),
                    namedVariables: JSONVariables,
                    indexedVariables: 0,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            case Packages.com.thingworx.dsl.engine.adapters.JSONArrayAdapter:
                JSONArrayName = 'JSONArrayAdapter'
            case Packages.org.json.JSONArray:
                if (isContent) return this._contentOfArrayList(object);
                JSONArrayName = JSONArrayName || 'JSONArray';

                return {
                    name: name || 'object',
                    type: JSONArrayName,
                    value: `${JSONArrayName}[${object.length}]`,
                    variablesReference: this._IDForObject(object),
                    namedVariables: 2, // The additional fields are length and class,
                    indexedVariables: object.length,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            // Thingworx types
            case Packages.com.thingworx.dsl.engine.adapters.ThingworxInfoTableAdapter:
                InfoTableName = 'ThingworxInfoTableAdapter';
            case Packages.com.thingworx.types.InfoTable:
                if (isContent) return this._contentOfInfoTable(object);
                InfoTableName = InfoTableName || 'InfoTable';

                return {
                    name: name || 'object',
                    type: InfoTableName,
                    value: `${InfoTableName}[${object.length}]`,
                    variablesReference: this._IDForObject(object),
                    namedVariables: 4, // The additional fields are dataShape, rows, length and class
                    indexedVariables: 0,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            case Packages.com.thingworx.metadata.DataShapeDefinition:
                if (isContent) return this._contentOfDataShape(object);
                return {
                    name: name || 'object',
                    type: 'DataShapeDefinition',
                    value: 'DataShapeDefinition',
                    variablesReference: this._IDForObject(object),
                    namedVariables: 2, // fields and class
                    indexedVariables: 0,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            case Packages.com.thingworx.metadata.collections.FieldDefinitionCollection:
                if (isContent) return this._contentOfFieldDefinitionCollection(object);
                return {
                    name: name || 'object',
                    type: 'FieldDefinitionCollection',
                    value: 'FieldDefinitionCollection',
                    variablesReference: this._IDForObject(object),
                    namedVariables: Object.keys(object).length + 1, // The additional field is class
                    indexedVariables: 0,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            case Packages.com.thingworx.metadata.FieldDefinition:
                if (isContent) return this._contentOfFieldDefinition(object);
                return {
                    name: name || 'object',
                    type: 'FieldDefinition',
                    value: 'FieldDefinition',
                    variablesReference: this._IDForObject(object),
                    namedVariables: 7, // The fields are name, baseType, description, ordinal, aspects, localDataShape and class
                    indexedVariables: 0,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            case Packages.com.thingworx.types.BaseTypes:
                if (isContent) return this._contentOfUnknownObject(object);
                return {
                    name: name || 'object',
                    type: 'BaseTypes.' + object.toString(),
                    value: 'BaseTypes.' + object.toString(),
                    variablesReference: this._IDForObject(object),
                    namedVariables: 1, // class
                    indexedVariables: 0,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            case Packages.com.thingworx.types.collections.ValueCollectionList:
                if (isContent) return this._contentOfArrayList(object);
                return {
                    name: name || 'object',
                    type: 'ValueCollectionList',
                    value: `ValueCollectionList[${object.length}]`,
                    variablesReference: this._IDForObject(object),
                    namedVariables: 2, // length and class
                    indexedVariables: object.length,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            case Packages.com.thingworx.types.TagCollection:
                if (isContent) return this._contentOfArrayList(object);
                return {
                    name: name || 'object',
                    type: 'TagCollection',
                    value: `TagCollection[${object.length}]`,
                    variablesReference: this._IDForObject(object),
                    namedVariables: 2, // length and class
                    indexedVariables: object.length,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            case Packages.java.lang.ArrayList:
                if (isContent) return this._contentOfArrayList(object);
                return {
                    name: name || 'object',
                    type: 'ArrayList',
                    value: `ArrayList[${object.length}]`,
                    variablesReference: this._IDForObject(object),
                    namedVariables: 2, // length and class
                    indexedVariables: object.length,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            case Packages.com.thingworx.types.collections.AspectCollection:
                ValueCollectionName = 'AspectCollection';
            case Packages.com.thingworx.types.collections.ValueCollection:
                if (isContent) return this._contentOfValueCollection(object);
                ValueCollectionName = ValueCollectionName || 'ValueCollection';

                return {
                    name: name || 'object',
                    type: ValueCollectionName,
                    value: ValueCollectionName,
                    variablesReference: this._IDForObject(object),
                    namedVariables: object.keySet().size() + 1,
                    indexedVariables: 0,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            case Packages.com.thingworx.types.TagLink:
                if (isContent) return [];
                return {
                    name: name || 'object',
                    type: 'TagLink',
                    value: object.toString(),
                    variablesReference: 0,
                    namedVariables: 0,
                    indexedVariables: 0,
                    presentationHint: presentationHint || defaultPresentationHint
                }
            case Packages.com.thingworx.types.primitives.structs:
                if (isContent) return this._contentOfLocation(object);
                return {
                    name: name || 'object',
                    type: 'Location',
                    value: object.toString(),
                    variablesReference: this._IDForObject(object),
                    namedVariables: 4,
                    indexedVariables: 0,
                    presentationHint: presentationHint || defaultPresentationHint
                }
        }

        // Native java arrays
        if (javaClass.isArray()) {
            if (isContent) return this._contentOfJavaArray(object);
            return {
                name: name || 'object',
                type: 'Java Array',
                value: `java array[${object.length}]`,
                variablesReference: this._IDForObject(object),
                namedVariables: 0,
                indexedVariables: object.length + 1,
                presentationHint: presentationHint || defaultPresentationHint
            }
        }

        // Wrapped java objects
        if (Packages.java.lang.Class.forName('org.mozilla.javascript.NativeJavaObject').isInstance(object)) {
            if (isContent) return this._contentOfObject(object);
            return {
                name: name || 'object',
                type: object.constructor?.name || 'Object',
                value: object.toString(),
                variablesReference: this._IDForObject(object),
                namedVariables: Object.getOwnPropertyNames(object).length + 1, // +1 is added for the prototype
                indexedVariables: 0,
                presentationHint: presentationHint || defaultPresentationHint
            }
        }

        // For javascript types, use typical js methods
        if (BMDebuggerRuntime._observingDebuggerClass.isScriptableInstance(object)) {
            // Array's prototype gets treated as an array itself, so the second part of this condition
            // causes it to go through the "object" branch
            if (Array.isArray(object) && Array.isArray(Object.getPrototypeOf(object))) {
                if (isContent) return this._contentOfArray(object);

                return {
                    name: name || 'array',
                    type: object.constructor?.name || 'Array',
                    value: `array[${object.length}]`,
                    variablesReference: this._IDForObject(object),
                    indexedVariables: object.length,
                    namedVariables: Object.getOwnPropertyNames(object).filter(p => isNaN(p as any)).length + 1, // +1 is added for the prototype
                    presentationHint: presentationHint || defaultPresentationHint
                }
            }

            switch (typeof object) {
                case 'object':
                    if (isContent) return this._contentOfObject(object);
                    return {
                        name: name || 'object',
                        type: object.constructor?.name || 'Object',
                        value: object.toString(),
                        variablesReference: this._IDForObject(object),
                        namedVariables: Object.getOwnPropertyNames(object).length + 1, // +1 is added for the prototype
                        indexedVariables: 0,
                        presentationHint: presentationHint || defaultPresentationHint
                    }
                case 'function':
                    if (isContent) return this._contentOfObject(object);
                    return {
                        name: name || 'object',
                        type: object.constructor?.name || 'Function',
                        value: `function ${object.name}`,
                        variablesReference: this._IDForObject(object),
                        namedVariables: Object.getOwnPropertyNames(object).length + 1, // +1 is added for the prototype
                        indexedVariables: 0,
                        presentationHint: presentationHint || defaultPresentationHint
                    }
                case 'number':
                    if (isContent) return this._contentOfObject(object);
                    return {
                        name: name || 'object',
                        type: object.constructor?.name || 'Number',
                        value: object.toString(),
                        variablesReference: 0,
                        namedVariables: 0,
                        indexedVariables: 0,
                        presentationHint: presentationHint || defaultPresentationHint
                    }
                case 'string':
                    if (isContent) return this._contentOfObject(object);
                    return {
                        name: name || 'object',
                        type: object.constructor?.name || 'String',
                        value: JSON.stringify(object),
                        variablesReference: 0,
                        namedVariables: 0,
                        indexedVariables: 0,
                        presentationHint: presentationHint || defaultPresentationHint
                    }
                case 'boolean':
                    if (isContent) return this._contentOfObject(object);
                    return {
                        name: name || 'object',
                        type: object.constructor?.name || 'Boolean',
                        value: object.toString(),
                        variablesReference: 0,
                        namedVariables: 0,
                        indexedVariables: 0,
                        presentationHint: presentationHint || defaultPresentationHint
                    }
                case 'undefined':
                    if (isContent) return this._contentOfObject(object);
                    return {
                        name: name || 'object',
                        type: 'undefined',
                        value: 'undefined',
                        variablesReference: 0,
                        namedVariables: 0,
                        indexedVariables: 0,
                        presentationHint: presentationHint || defaultPresentationHint
                    }
            }
        }

        // When the object doesn't pass any checks, return a generic description
        if (isContent) return this._contentOfUnknownObject(object);
        return {
            name: name || 'unknown',
            type: javaClass.getName(),
            value: javaClass.getName(),
            variablesReference: this._IDForObject(object),
            indexedVariables: 0,
            namedVariables: 1, // This will only contain the class
            presentationHint: presentationHint || {
                kind: 'unknown',
                attributes: [],
                visibility: 'unknown'
            }
        }
    }

    /**
     * Returns the contents of the given thing.
     * @param object    The thing.
     * @returns         An array of contained variables.
     */
    private static _contentOfThing(thing: GenericThing): BMDebuggerVariable[] {
        if (!thing.IsEnabled()) {
            return [];
        }

        const result: BMDebuggerVariable[] = [];

        // Add an entry for each property definition
        for (const property of thing.GetPropertyDefinitions()) {
            const attributes: string[] = [];

            if (property.isReadOnly) attributes.push('constant');
            if (property.isPersistent) attributes.push('persistent');
            if (property.isLogged) attributes.push('logged');
            
            result.push(this._infoForObject(thing[property.name], property.name, {visibility: 'public', attributes, kind: 'property'}));
        }

        result.push(this._infoForObject(ThingTemplates[thing.thingTemplate], '@template', {visibility: 'public', attributes: [], kind: 'virtual'}));
        for (const shape of thing.GetLocallyImplementedShapes()) {
            result.push(this._infoForObject(ThingShapes[shape.name], '@shape', {visibility: 'public', attributes: [], kind: 'virtual'}));
        }

        return result;
    }

    /**
     * Returns the contents of the given thing.
     * @param object    The thing.
     * @returns         An array of contained variables.
     */
    private static _contentOfRootEntity(entity: ThingTemplateEntity<GenericThing>): BMDebuggerVariable[] {
        const result: BMDebuggerVariable[] = [];

        const metadata = entity.GetMetadata();

        const jsonMetadata: any = ['ThingTemplate', 'ThingShape'].indexOf(metadata.type) != -1 ? entity.GetInstanceMetadataAsJSON() : entity.GetMetadataAsJSON();

        // Add an entry for each property definition
        for (const propName in jsonMetadata.propertyDefinitions) {
            const property = jsonMetadata.propertyDefinitions[propName];
            // Omit properties originating from other entities
            if (property.sourceName != metadata.name || property.sourceType != metadata.type) continue;

            const attributes: string[] = [];

            if (property.aspects.isReadOnly) attributes.push('constant');
            if (property.aspects.isPersistent) attributes.push('persistent');
            if (property.aspects.isLogged) attributes.push('logged');
            
            result.push({
                name: property.name,
                value: property.baseType,
                type: 'property',
                variablesReference: 0,
                namedVariables: 0,
                indexedVariables: 0,
                presentationHint: {visibility: 'public', attributes, kind: 'property'},
            });
        }

        // Add an entry for each service definition
        for (const serviceName in jsonMetadata.serviceDefinitions) {
            const service = jsonMetadata.serviceDefinitions[serviceName];
            // Omit services originating from other entities
            if (service.sourceName != metadata.name || service.sourceType != metadata.type) continue;

            const attributes: string[] = [];
            
            result.push({
                name: service.name,
                value: 'service',
                type: 'service',
                variablesReference: 0,
                namedVariables: 0,
                indexedVariables: 0,
                presentationHint: {visibility: 'public', attributes, kind: 'method'},
            });
        }

        // Add an entry for each service definition
        for (const eventName in jsonMetadata.eventDefinitions) {
            const event = jsonMetadata.eventDefinitions[eventName];
            // Omit services originating from other entities
            if (event.sourceName != metadata.name || event.sourceType != metadata.type) continue;

            const attributes: string[] = [];
            
            result.push({
                name: event.name,
                value: 'event',
                type: 'event',
                variablesReference: 0,
                namedVariables: 0,
                indexedVariables: 0,
                presentationHint: {visibility: 'public', attributes, kind: 'method'},
            });
        }

        // For thing templates, include a reference to the parent template and implemented shapes
        if (metadata.type == 'ThingTemplate') {
            result.push(this._infoForObject(ThingTemplates[entity.GetBaseThingTemplate()], '@template', {visibility: 'public', attributes: [], kind: 'virtual'}));

            const getShapes = Packages.java.lang.Class.forName('com.thingworx.thingtemplates.ThingTemplate').getDeclaredMethod('getLocalImplementedThingShapes');
            getShapes.setAccessible(true);
            const shapes = getShapes.invoke(entity);
            const length = shapes.size();

            for (let i = 0; i < length; i++) {
                result.push(this._infoForObject(ThingShapes[shapes.get(i).getName()], '@shape', {visibility: 'public', attributes: [], kind: 'virtual'}));
            }
        }


        return result;
    }

    /**
     * Returns the content of the given unkown object.
     * @param object        The object.
     * @returns             The object's content.
     */
    private static _contentOfUnknownObject(object: any): BMDebuggerVariable[] {
        const result: BMDebuggerVariable[] = [];

        result.push(this._infoForObject(this._getClass.invoke(object), '@class', {attributes: [], visibility: 'public', kind: 'virtual'}));

        return result;
    }

    /**
     * Returns the content of the given data shape definition object.
     * @param object        The object.
     * @returns             The object's content.
     */
    private static _contentOfDataShape(object: any): BMDebuggerVariable[] {
        const result: BMDebuggerVariable[] = [];

        result.push(this._infoForObject(object.fields, 'fields', {attributes: [], visibility: 'public', kind: 'property'}));
        result.push(this._infoForObject(this._getClass.invoke(object), '@class', {attributes: [], visibility: 'public', kind: 'virtual'}));

        return result;
    }

    /**
     * Returns the content of the given field definition object.
     * @param object        The object.
     * @returns             The object's content.
     */
    private static _contentOfFieldDefinition(object: any): BMDebuggerVariable[] {
        const result: BMDebuggerVariable[] = [];

        result.push(this._infoForObject(object.name, 'name', {attributes: [], visibility: 'public', kind: 'property'}));
        result.push(this._infoForObject(object.baseType, 'baseType', {attributes: [], visibility: 'public', kind: 'property'}));
        result.push(this._infoForObject(object.ordinal, 'ordinal', {attributes: [], visibility: 'public', kind: 'property'}));
        result.push(this._infoForObject(object.description, 'description', {attributes: [], visibility: 'public', kind: 'property'}));
        result.push(this._infoForObject(object.aspects, 'aspects', {attributes: [], visibility: 'public', kind: 'property'}));
        result.push(this._infoForObject(object.localDataShape, 'localDataShape', {attributes: [], visibility: 'public', kind: 'property'}));
        result.push(this._infoForObject(this._getClass.invoke(object), '@class', {attributes: [], visibility: 'public', kind: 'virtual'}));

        return result;
    }

    /**
     * Returns the content of the given field definition collection object.
     * @param object        The object.
     * @returns             The object's content.
     */
    private static _contentOfFieldDefinitionCollection(object: any): BMDebuggerVariable[] {
        const result: BMDebuggerVariable[] = [];

        for (const key of Object.keys(object)) {
            result.push(this._infoForObject(object[key], key, {attributes: [], visibility: 'public', kind: 'property'}));
        }
        result.push(this._infoForObject(this._getClass.invoke(object), '@class', {attributes: [], visibility: 'public', kind: 'virtual'}));

        return result;
    }


    /**
     * Returns the content of the given java class.
     * @param object        The class.
     * @returns             The class contents.
     */
    private static _contentOfClass(javaClass: any): BMDebuggerVariable[] {
        const result: BMDebuggerVariable[] = [];

        for (const field of javaClass.getDeclaredFields()) {
            result.push(this._infoForObject(field, field.getName(), {attributes: [], visibility: 'unknown', kind: 'field'}));
        }

        for (const method of javaClass.getDeclaredMethods()) {
            result.push(this._infoForObject(method, method.getName(), {attributes: [], visibility: 'unknown', kind: 'field'}));
        }

        result.push(this._infoForObject(javaClass.getSuperclass(), '@class', {attributes: [], visibility: 'public', kind: 'virtual'}));

        return result;
    }

    /**
     * Returns the contents of the given java array.
     * @param object    The java array.
     * @returns         An array of contained variables.
     */
    private static _contentOfJavaArray(array: any[]): BMDebuggerVariable[] {
        const result: BMDebuggerVariable[] = [];
        for (let i = 0; i < array.length; i++) {
            result.push(this._infoForObject(array[i], i.toString(), {
                attributes: [],
                kind: 'property',
                visibility: 'public'
            }));
        }

        result.push(this._infoForObject(BMDebuggerRuntime._getClass.invoke(array), '@class', {attributes: [], visibility: 'public', kind: 'virtual'}));

        return result;
    }

    /**
     * Returns the contents of the given infotable.
     * @param table     The infotable.
     * @returns         An array of contained variables.
     */
    private static _contentOfInfoTable(table: any): BMDebuggerVariable[] {
        const result: BMDebuggerVariable[] = [];
        
        result.push(this._infoForObject(table.dataShape, 'dataShape', {attributes: [], visibility: 'public', kind: 'property'}));
        result.push(this._infoForObject(table.rows, 'rows', {attributes: [], visibility: 'public', kind: 'property'}));
        result.push(this._infoForObject(table.length, 'length', {attributes: [], visibility: 'public', kind: 'property'}));

        result.push(this._infoForObject(BMDebuggerRuntime._getClass.invoke(table), '@class', {attributes: [], visibility: 'public', kind: 'virtual'}));

        return result;
    }

    /**
     * Returns the contents of the given location.
     * @param location      The location.
     * @returns             An array of contained variables.
     */
    private static _contentOfLocation(location: LOCATION): BMDebuggerVariable[] {
        const result: BMDebuggerVariable[] = [];
        
        result.push(this._infoForObject(location.latitude, 'latitude', {attributes: [], visibility: 'public', kind: 'property'}));
        result.push(this._infoForObject(location.longitude, 'longitude', {attributes: [], visibility: 'public', kind: 'property'}));
        result.push(this._infoForObject(location.altitude, 'altitude', {attributes: [], visibility: 'public', kind: 'property'}));

        result.push(this._infoForObject(BMDebuggerRuntime._getClass.invoke(location), '@class', {attributes: [], visibility: 'public', kind: 'virtual'}));

        return result;
    }

    /**
     * Returns the contents of the given array list.
     * @param list      The array list.
     * @returns         An array of contained variables.
     */
    private static _contentOfArrayList(list: any): BMDebuggerVariable[] {
        const result: BMDebuggerVariable[] = [];
        
        for (let i = 0; i < list.length; i++) {
            result.push(this._infoForObject(list[i], i.toFixed(), {attributes: [], visibility: 'public', kind: 'property'}));
        }

        result.push(this._infoForObject(list.length, 'length', {attributes: [], visibility: 'public', kind: 'property'}));

        result.push(this._infoForObject(BMDebuggerRuntime._getClass.invoke(list), '@class', {attributes: [], visibility: 'public', kind: 'virtual'}));

        return result;
    }

    /**
     * Returns the contents of the given value collection.
     * @param collection        The value collection.
     * @returns                 An array of contained variables.
     */
    private static _contentOfValueCollection(collection: any): BMDebuggerVariable[] {
        const result: BMDebuggerVariable[] = [];
        
        for (const key of collection.keySet().toArray()) {
            result.push(this._infoForObject(collection[key], key.toString(), {attributes: [], visibility: 'public', kind: 'property'}));
        }

        result.push(this._infoForObject(BMDebuggerRuntime._getClass.invoke(collection), '@class', {attributes: [], visibility: 'public', kind: 'virtual'}));

        return result;
    }

    /**
     * Returns the contents of the given array.
     * @param array         The array.
     * @returns             An array of contained variables.
     */
    private static _contentOfArray(array: any[]): BMDebuggerVariable[] {
        const result: BMDebuggerVariable[] = [];
        for (let i = 0; i < array.length; i++) {
            result.push(this._infoForObject(array[i], i.toString(), {
                attributes: [],
                kind: 'property',
                visibility: 'public'
            }));
        }

        for (const name of Object.getOwnPropertyNames(array)) {
            if (!Number.isNaN(name)) continue;
            const descriptor = Object.getOwnPropertyDescriptor(array, name)!;
            const attributes: string[] = [];
            if (!descriptor.writable) {
                attributes.push('constant');
            }

            result.push(this._infoForObject(array[name], name, {attributes, visibility: 'public', kind: 'property'}));
        }

        result.push(this._infoForObject(Object.getPrototypeOf(array), '@prototype', {attributes: [], visibility: 'public', kind: 'virtual'}));

        return result;
    }

    /**
     * Returns the contents of the given javascript object.
     * @param object    The object.
     * @returns         An array of contained variables.
     */
    private static _contentOfObject(object: any): BMDebuggerVariable[] {
        const result: BMDebuggerVariable[] = [];

        for (const name of Object.getOwnPropertyNames(object)) {
            // Exclude debugger properties
            if (name == '__d' || name == "__dLogger") continue;

            const descriptor = Object.getOwnPropertyDescriptor(object, name)!;
            const attributes: string[] = [];
            if (!descriptor.writable) {
                attributes.push('constant');
            }

            result.push(this._infoForObject(object[name], name, {attributes, visibility: 'public', kind: 'property'}));
        }

        result.push(this._infoForObject(Object.getPrototypeOf(object), '@prototype', {attributes: [], visibility: 'public', kind: 'virtual'}));

        return result;
    }



    /**
     * Returns the contents of the given non-native JSONObject.
     * @param object    The object.
     * @returns         An array of contained variables.
     */
     private static _contentOfJSONObject(object: any): BMDebuggerVariable[] {
        const result: BMDebuggerVariable[] = [];

        for (const key in object) {
            result.push(this._infoForObject(object[key], key, {attributes: [], visibility: 'public', kind: 'property'}));
        }

        result.push(this._infoForObject(null, '@prototype', {attributes: [], visibility: 'private', kind: 'virtual'}));

        return result;
    }

    /**
     * Returns the contents of the given variable.
     * @param reference     The ID of the variable.
     * @returns             The contents of the variable.
     */
    static contentsOfVariable(reference: number): BMDebuggerVariable[] {
        const object = this._nativeObjectMap.get(reference);

        return this._infoForObject(object?.get(), true);
    }

    /**
     * Sets the specified field on the given variable reference to a new value.
     * @param reference         The ID of the variable.
     * @param name              The name of the field to set.
     * @param value             The value to set.
     */
    static setVariableValue(reference: number, name: string, value: any): BMDebuggerVariable {
        const object = this._nativeObjectMap.get(reference);

        if (!object || !object.get()) {
            throw new Error(`The object referenced via ID ${reference} doesn't exist.`);
        }

        object.get()[name] = value;

        return this._infoForObject(value, name, {attributes: [], kind: 'property', visibility: 'public'});
    }

    /**
     * Evaluates the given expression and returns its result as a variable.
     * @param expression        The expression to evaluate.
     * @param frameID           The stack frame in which to evaluate it.
     * @returns                 The result if no errors occur during the evaluation, otherwise the value that was thrown.
     */
    evaluateExpression(expression, frameID): BMDebuggerVariable {
        if (frameID === undefined) {
            return BMDebuggerRuntime._infoForObject(new TypeError('Unable to evaluate expression in the global scope.'));
        }

        if (!this._isSuspended) {
            return BMDebuggerRuntime._infoForObject(new Error('Unable to evaluate expression in a running thread'));
        }

        // Create a lock with a condition that will be used to await the evaluation's result
        const lock: Lock = new Packages.java.util.concurrent.locks.ReentrantLock();
        
        const command: BMDebuggerEvaluateCommand = {
            kind: BMDebuggerCommandKind.Evaluate,
            condition: lock.newCondition(),
            expression,
            frameID,
            finished: false,
            lock,
        }
        
        lock.lock();
        try {
            // Issue the evaluate command
            this._executeCommand(command);

            // Await its completion
            while (!command.finished) {
                command.condition.await();
            }

            
            // Return the result
            return command.result;
        }
        finally {
            lock.unlock();
        }
    }

    /**
     * Evaluates the given expression and returns its result as a variable. This must only be invoked
     * from the debugger's thread.
     * @param expression        The expression to evaluate.
     * @param frameID           The stack frame in which to evaluate it.
     * @returns                 The result if no errors occur during the evaluation, otherwise the value that was thrown.
     */
    _evaluateExpression(expression, frameID): BMDebuggerVariable {
        const context = Packages.org.mozilla.javascript.Context.getCurrentContext();
        
        // Find the stack frame with the given sequence ID
        let frame: BMDebuggerServiceScope | undefined;
        for (const service of this.serviceStack) {
            for (const serviceFrame of service.scopeStack) {
                if (serviceFrame.kind == BMDebuggerScopeKind.Service && serviceFrame.id == frameID) {
                    frame = serviceFrame;
                    break;
                }
            }

            if (frame) break;
        }

        if (!frame) return BMDebuggerRuntime._infoForObject(new Error('Unable to find the stack frame.'), 'result');

        // Evaluate the expression and return the result if sucessful, the error otherwise
        try {
            this._isEvaluatingExpression = true;
            return BMDebuggerRuntime._infoForObject(context.evaluateString(frame.activationObject, expression, '(bmdb)', 0, null));
        } 
        catch (e) {
            return BMDebuggerRuntime._infoForObject(e, 'result');
        }
        finally {
            this._isEvaluatingExpression = false;
        }
    }

    /**
     * Evaluates the given expression in the global scope and returns its result as a variable.
     * @param expression        The expression to evaluate.
     * @returns                 The result if no errors occur during the evaluation, otherwise the value that was thrown.
     */
    static evaluateExpressionGlobally(expression): BMDebuggerVariable {
        const context = Packages.org.mozilla.javascript.Context.getCurrentContext();
        const globalObject = (function (this: any) {return this;})();

        try {
            return BMDebuggerRuntime._infoForObject(context.evaluateString(globalObject, expression, '(bmdb)', 0, null));
        } 
        catch (e) {
            return BMDebuggerRuntime._infoForObject(e, 'result');
        }
    }

    /**
     * Returns the scopes for the frame with the given sequence ID. This may be invoked from any thread.
     * @param sequenceID        The sequence ID of the stack frame.
     * @returns                 An array of scopes.
     */
    scopesForStackFrame(sequenceID: number): BMDebuggerScope[] {
        this._suspendLock.lock();

        try {
            return this._scopesForStackFrame(sequenceID);
        }
        finally {
            this._suspendLock.unlock();
        }
    }

    /**
     * Returns the thrown value that caused this debugger's thread to suspend, if any.
     * @returns     The thrown value.
     */
    exception(): any {
        this._suspendLock.lock();

        try {
            return this._exception;
        }
        finally {
            this._suspendLock.unlock();
        }
    }

    /**
     * Returns details about the current exception.
     * @returns     Exception details.
     */
    exceptionDetails(): BMDebuggerExceptionResponse {
        this._suspendLock.lock();

        try {
            return this._exceptionDetails();
        }
        finally {
            this._suspendLock.unlock();
        }
    }

    /**
     * Returns details about the current exception.
     * @returns     Exception details.
     */
    private _exceptionDetails(): BMDebuggerExceptionResponse {
        const exception = this._exception;
        if (!exception) {
            // If the thread doesn't have any error, return a generic message
            return {
                breakMode: 'always',
                description: 'An error has occurred',
                exceptionId: '0',
                details: undefined
            };
        }

        if (exception instanceof Error) {
            // If the exception is an instance of error, return its fields and, when possible,
            // details about the underlying java throwable
            return {
                breakMode: 'always',
                description: exception.message,
                exceptionId: exception.name,
                details: BMDebuggerRuntime.detailsOfError(exception)
            }
        }
        else if (Packages.java.lang.Class.forName('java.lang.Throwable').isInstance(exception)) {
            // If the exception is a java exception, return its fields and information about its
            // caused by throwable
            const details = BMDebuggerRuntime._detailsOfThrowable(exception, undefined);
            return {
                breakMode: 'always',
                description: exception.getMessage(),
                exceptionId: BMDebuggerRuntime._typeNameOfJavaClass(exception.getClass()),
                details: details ? details[0] : undefined
            }
        }

        // If the thrown value is not an error, try to convert it to string and use it as the message
        return {
            breakMode: 'always',
            description: exception.toString(),
            exceptionId: '0',
            details: undefined
        }
    }

    /**
     * Returns an object that contains additional details about an error.
     * @param e         The error.
     * @returns         Details about the error.
     */
    static detailsOfError(e: BMDebuggerError): BMDebuggerExceptionDetails {
        return {
            fullTypeName: e.name,
            message: e.message,
            stackTrace: e.stack,
            typeName: e.name,
            innerException: e.rhinoException ? this._detailsOfThrowable(e.rhinoException, e) : undefined
        };
    }

    /**
     * Returns an object wrapped in an array that contains additional details about a java throwable.
     * @param e         The throwable.
     * @param source    The source throwable.
     * @returns         Details about the error.
     */
    private static _detailsOfThrowable(e: any, source: any): BMDebuggerExceptionDetails[] | undefined {
        // If the throwable's cause is itself, don't continue
        if (e == source) return;

        const result: BMDebuggerExceptionDetails[] = [];
        result.push({
            fullTypeName: e.getClass().getName(),
            message: e.getMessage(),
            stackTrace: e.getStackTrace().join('\n'),
            typeName: this._typeNameOfJavaClass(e.getClass()),
            innerException: e.getCause() ? this._detailsOfThrowable(e.getCause(), e) : undefined
        });

        return result;
    }

    /**
     * Suspends the current thread and waits for a new command to execute.
     * @param reason        A constant that describes why this thread was suspended.
     * @param args          Additional arguments describing the stop reason.
     */
    private _suspend(reason?: BMDebuggerSuspendReason, ...args: any[]): void {
        // Don't process evaluation events
        if (this._isEvaluatingExpression) return;

        this._suspendLock.lock();

        // Clear out the current command
        this._command = undefined;

        try {
            this._isSuspended = true;

            // Set up an appropriate stop reason
            switch (reason) {
                case BMDebuggerSuspendReason.Breakpoint:
                    const breakpoint = args[0] as BMDebuggerBreakpoint
                    this._suspensionReason = `breakpoint`;
                    break;
                case BMDebuggerSuspendReason.Command:
                    const command = args[0] as BMDebuggerCommand;
                    this._suspensionReason = `step`;
                    break;
                case BMDebuggerSuspendReason.Exception:
                    this._exception = args[0];
                    this._suspensionReason = `exception`;
                    break;
                case BMDebuggerSuspendReason.Requested:
                    this._suspensionReason = `pause`;
                    break;
                default:
                    this._suspensionReason = `pause`;
            }

            // Dispatch a message to attached debuggers notifying them that the thread is stopped
            const message = {
                name: 'suspended', 
                reason: this._suspensionReason!, 
                threadID: this.threadID(), 
                exception: this._exception ? (this._exception.message || 'error') : undefined
            } as BMDebuggerSuspendMessage;

            try {
                Subsystems.BMObservingDebugger.SendMessage({message: JSON.stringify(message)});
            }
            catch (e) {

            }

            while (this._isSuspended) {
                // Suspend the thread, waiting for a new command to become available.
                while (!this._command) {
                    this._commandCondition.await();
                }
    
                // Typescript doesn't know that a different thread may modify the command
                // so a typecast is necessary
                const command = this._command as BMDebuggerCommand;
    
                switch (command.kind) {
                    case BMDebuggerCommandKind.Suspend:
                        this._isSuspended = true;
                        break;
                    case BMDebuggerCommandKind.Evaluate:
                        // Evaluate the command and store the result
                        const evaluateCommand = command as BMDebuggerEvaluateCommand;
                        evaluateCommand.result = this._evaluateExpression(evaluateCommand.expression, evaluateCommand.frameID);

                        // Signal the await thread
                        evaluateCommand.lock.lock();
                        evaluateCommand.finished = true;
                        evaluateCommand.condition.signal();
                        evaluateCommand.lock.unlock();
                        
                        // Await a new command
                        this._command = undefined;
                        this._isSuspended = true;
                        break;
                    default:
                        logger.error(`Unknown command kind "${command.kind}" sent to debugger, treating as "Resume".`);
                        this._command = {kind: BMDebuggerCommandKind.Resume};
                    // All of the following commands cause the debugger to resume execution
                    case BMDebuggerCommandKind.Step:
                    case BMDebuggerCommandKind.StepIn:
                    case BMDebuggerCommandKind.StepOut:
                    case BMDebuggerCommandKind.Resume:
                        this._isSuspended = false;
                }

                // If no longer suspended, dispatch a message to the attached debuggers
                if (!this._isSuspended) {
                    // Clear out the thread's exception
                    this._exception = undefined;

                    const message = {name: 'resumed', threadID: this.threadID()} as BMDebuggerResumedMessage;
                    try {
                        Subsystems.BMObservingDebugger.SendMessage({message: JSON.stringify(message)});
                    }
                    catch (e) {

                    }
                }
            }
        }
        finally {
            this._suspendLock.unlock();
        }
    }

    /**
     * Causes the thread to suspend immediately. This must only be invoked from this runtime's thread.
     */
    debugger(): void {
        if (BMDebuggerRuntime._connectedDebuggers) {
            this._suspend(BMDebuggerSuspendReason.Requested, []);
        }
    }

    /**
     * A method that is repeatedly invoked while a debug script is being executed. Verifies if the debugger
     * should stop for any reason (such as a breakpoint or command) and if it does, suspends execution
     * on this thread and waits for a new command.
     * 
     * This must only be invoked from this runtime's thread.
     * @param ID        The ID of the breakpoint at the current line and character position.
     */
    checkpoint(ID: string): void {
        // Don't process evaluation events
        if (this._isEvaluatingExpression) return;

        // Don't attempt to pause if no debuggers are connected
        if (!BMDebuggerRuntime._connectedDebuggers) return;

        // Set to true if this suspends, to prevent suspending at this location twice
        let didSuspend = false;

        // Find the breakpoint for the specified ID
        const breakpoint = BMDebuggerRuntime._allBreakpoints[ID];
        if (breakpoint) {
            if (this.currentService) {
                // Update the service's execution progress to the given checkpoint
                this.currentService.line = breakpoint.line;
                this.currentService.column = breakpoint.column || 0;
            }

            const activation = this.currentScope;
            if (activation) {
                activation.line = breakpoint.line;
                activation.column = breakpoint.column || 0;
            }

            if (breakpoint.active) {
                let shouldSuspend = true;

                if (breakpoint.condition && activation) {
                    // If the breakpoint specifies a condition, evaluate it and only suspend it it returns a truthy value
                    const context = Packages.org.mozilla.javascript.Context.getCurrentContext();

                    // TODO: Should suspension be disabled while evaluating a command?
                    let result;
                    try {
                        this._isEvaluatingExpression = true;
                        result = context.evaluateString(activation.activationObject, breakpoint.condition, '(bmdb)', 0, null);
                    } 
                    catch (e) {
                        result = false;
                    }
                    finally {
                        this._isEvaluatingExpression = false;
                    }

                    shouldSuspend = !!result;
                }

                // If the breakpoint is active and its optional condition evaluates to true, suspend
                if (shouldSuspend) {
                    didSuspend = true;
                    this._suspend(BMDebuggerSuspendReason.Breakpoint, [breakpoint]);
                }
            }
        }

        // execution may also suspend for a step command
        if (this._command && !didSuspend) {
            switch (this._command.kind) {
                case BMDebuggerCommandKind.Step:
                    // For a step over command, the source activation object must be the current one
                    if ((this._command as BMDebuggerStepOverCommand).activationObject != this.currentScope?.activationObject) {
                        break;
                    }
                case BMDebuggerCommandKind.StepIn:
                    // For stepping in, all checkpoints should suspend
                    this._suspend(BMDebuggerSuspendReason.Command, [this._command]);
                    break;
                case BMDebuggerCommandKind.Suspend:
                    // For a requested suspension, all checkpoints should suspend
                    this._suspend((this._command as BMDebuggerSuspendCommand).reason, (this._command as BMDebuggerSuspendCommand).args);
                    break;
            }
        }
    }

    toString() {
        return '[object BMDebuggerRuntime]';
    }

    static toString() {
        return '[object BMDebuggerRuntimeStatic]';
    }

    /**
     * Invoked when the debugger is installed or updated; loads all available
     * debug information.
     */
    private static _initialize = (() => {
        try {
            const things = Resources.SearchFunctions.SearchThings({maxItems: 9999, modelTags: 'Debugger:DebugInfo'});
            for (const thing of things.thingResults) {
                BMDebuggerRuntime.registerExtensionPackage(thing.name);
            }
        }
        catch (e) {
            // When the server starts up, this can be invoked before other things are initialized which may cause
            // an error to be thrown, in this case the extension packages will have to be registered manually
        }
    })();

}