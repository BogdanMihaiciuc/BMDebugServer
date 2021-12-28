
/**
 * The interface for a rhino debugger that can be used to retrieve debug information about the currently
 * running script.
 */
interface RhinoDebugger {

    /**
     * Invoked whenever execution enters a function or begins evaluating a new script.
     * @param context       The rhino context.
     * @param scope         The new scope that was entered.
     * @returns             A debugger frame that will receive information about the script that is being executed.
     */
    getFrame(context: any, scope: any): RhinoDebuggerFrame;

    /**
     * Invoked when compilation finishes for a script.
     * @param context       The rhino context.
     * @param scope         The script or function that was compiled.
     * @param source        The source code.
     */
    handleCompilationDone(context: any, scope: any, source: string): void;
}

/**
 * The interface for a rhino debugger frame that receives debugging information about a script as it is executed.
 */
interface RhinoDebuggerFrame {

    onDebuggerStatement(context: any): void;

    onEnter(context: any, activation: any, thisObject: any, args: any[]): void;

    onExceptionThrown(context: any, exception: any): void;

    onExit(context: any, byThrow: boolean, resultOrException: any): void;

    onLineChange(context: any, line: number): void;
}