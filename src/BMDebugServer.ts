/**
 * The debug server is a thing that acts as an interface between Thingworx and a Visual Studio Code debug protocol adapter.
 * It is only meant to be used with projects built via ThingworxVSCodeProject with the debug flag enabled.
 * 
 * It can also act as a REST API to enable other debugger frontends.
 */
@ThingDefinition class BMDebugServer extends GenericThing {

    /**
     * Returns an infotable containing information about the currently running threads.
     * @returns     An infotable of the currently running debug threads.
     */
    getThreads(): INFOTABLE<BMDebugThread> {
        const threads = DataShapes.BMDebugThread.CreateValues();

        BMDebuggerRuntime.activeDebuggers().forEach(debugRuntime => {
            const threadID = debugRuntime.threadID();
            if (debugRuntime.isSuspended()) {
                threads.AddRow({
                    ID: threadID, 
                    state: BMDebugThreadState.Suspended,
                    reason: debugRuntime.suspensionReason(),
                    stackTrace: debugRuntime.stackTrace()?.map(t => t.name).join('\n')
                });
            }
            else {
                threads.AddRow({ID: threadID, state: BMDebugThreadState.Running});
            }
        });

        return threads;
    }

    /**
     * Returns an infotable that contains all possible breakpoint locations known to the debugger.
     * @returns     An infotable of breakpoint locations.
     */
    getAllBreakpointLocations(): INFOTABLE<BMDebuggerBreakpointLocation> {
        const result = DataShapes.BMDebuggerBreakpointLocation.CreateValues();

        BMDebuggerRuntime.allBreakpointLocations().forEach(l => result.AddRow(l));

        return result;
    }

    /**
     * Returns an infotable that contains all possible breakpoint locations in the given file known to the debugger,
     * within the given character range.
     * @param path      The path of the file.
     * @returns         An infotable of breakpoint locations.
     */
    getBreakpointLocationsInFile({path, line, column, endLine, endColumn}: {path: string, line: number, column?: number, endLine?: number, endColumn?: number}): INFOTABLE<BMDebuggerBreakpointLocation> {
        column ??= 0;
        endLine ??= line;
        endColumn ??= 9007199254740991; // MAX_SAFE_INT

        const locationsInFile = Resources.InfoTableFunctions.EQFilter({t: this.getAllBreakpointLocations(), fieldName: 'fileName', isCaseSensitive: false, value: path});
        const locations = DataShapes.BMDebuggerBreakpointLocation.CreateValues();

        locationsInFile.rows.toArray().forEach(r => {
            if (!(r.column! > endColumn! ||
                r.endColumn! < column! ||
                r.line > endLine! ||
                r.endLine! < line)) {
                    locations.AddRow(r);
                }
        });

        return locations;
    }

    /**
     * Sets the active breakpoints in a given source file.
     * @param path              The path to the file in which the breakpoints should be set.
     * @param breakpoints       An object containing the list of breakponts to be activated.
     * @returns                 An infotable containing a description of which breakpoints could be activated.
     */
    setBreakpointsForFile({path, breakpoints}: {path: string, breakpoints: TWJSON<BMDebuggerSetBreakpointsRequest>}): INFOTABLE<BMDebuggerBreakpointResponse> {
        const result = BMDebuggerRuntime.setBreakpoints(path, breakpoints.breakpoints);
        const response = DataShapes.BMDebuggerBreakpointResponse.CreateValues();

        for (const row of result) {
            response.AddRow(row);
        }

        return response;
    }

    /**
     * Retrieves the call stack information of the given thread, if it is suspended.
     * If the thread is not suspended, the response is not defined.
     * @param threadID          The ID of the thread whose stack trace should be retrieved.
     * @returns                 The stack trace.
     */
    getStackTraceInThread({threadID}: {threadID: number}): INFOTABLE<BMDebuggerStackTrace> {
        const result = DataShapes.BMDebuggerStackTrace.CreateValues();

        const runtime = BMDebuggerRuntime.debuggerForThread(threadID);
        if (!runtime) return result;

        const frames = runtime.stackTrace();
        if (!frames) return result;

        for (const frame of frames) {
            result.AddRow(frame);
        }

        return result;
    }

    /**
     * Retrieves the scopes for the given stack frame in the given thread, if the thread is suspended.
     * If the thread is not suspended, the response is not defined.
     * @param threadID          The ID of the thread.
     * @param frameID           The ID of the stack frame for which to retrieve scopes.
     * @returns                 An infotable containing the scopes.
     */
    getScopesInThread({threadID, frameID}: {threadID: number, frameID: number}): INFOTABLE<BMDebuggerScopeResponse> {
        const result = DataShapes.BMDebuggerScopeResponse.CreateValues();

        const scopes = BMDebuggerRuntime.debuggerForThread(threadID)?.scopesForStackFrame(frameID);
        if (!scopes) return result;

        for (const scope of scopes) {
            result.AddRow(scope);
        }

        return result;
    }

    /**
     * Retrieves the fields in the given variable container. This method must only be invoked while the thread containing
     * the requested variable is suspended.
     * @param reference         The ID of the variable or scope.
     * @param filter            If specified, must be `"indexed"` or `"named"`. The kind of fields to return.
     *                          If omitted, all fields will be returned.
     * @param start             If specified, the number of fields to skip.
     * @param count             If specified, the number of fields to return. If omitted, all fields are returned.
     * @returns                 The fields in the given variable.
     */
    getVariableContents({reference, filter, start, count}: {reference: number, filter?: string, start?: number, count?: number}): INFOTABLE<BMDebuggerVariableResponse> {
        let content = BMDebuggerRuntime.contentsOfVariable(reference);
        const result = DataShapes.BMDebuggerVariableResponse.CreateValues();

        for (let i = 0; i < content.length; i++) {
            const variable = content[i];

            // If a type filter is specified, omit entries that don't match it
            if (filter) {
                if (filter == 'indexed' && isNaN(variable.name as any)) continue;
                if (filter == 'named' && !isNaN(variable.name as any)) continue;
            }

            result.AddRow(variable);
        }


        // If only a subset is requested, only return the subset
        if (start || count) {
            if (!count) {
                count = result.rows.length - (start || 0);
            }
            const slicedContent = Array.prototype.slice.call(result.rows, start || 0, ((start || 0) + count));
            result.RemoveAllRows();

            for (const row of slicedContent) {
                result.AddRow(row);
            }
        }

        return result;
    }

    /**
     * Sets the specified field on the given variable to a new value. This method must only be invoked while the thread containing
     * the requested variable is suspended.
     * @param reference         The ID of the variable or scope.
     * @param name              The name of the field to set.
     * @param value             The value to assign. This must be a JSON string.
     * @return                  The updated field.
     */
    setVariable({reference, name, value}: {reference: number, name: string, value: string}): INFOTABLE<BMDebuggerVariableResponse> {
        const actualValue = JSON.parse(value);
        const field = BMDebuggerRuntime.setVariableValue(reference, name, actualValue);

        return DataShapes.BMDebuggerVariableResponse.CreateValuesWithData({values: field as any});
    }

    /**
     * Evaluates the given expression and returns its result.
     * @param expression        The expression to evaluate.
     * @param frameID           The frame in which to evaluate the expression.
     * @param threadID          The thread in which to evaluate the expression. 
     * @returns                 The result.
     */
    evaluate({expression, frameID, threadID}: {expression: string, frameID: number, threadID: number}): INFOTABLE<BMDebuggerVariableResponse> {
        const runtime = BMDebuggerRuntime.debuggerForThread(threadID)!;
        const result = runtime.evaluateExpression(expression, frameID);

        return DataShapes.BMDebuggerVariableResponse.CreateValuesWithData({values: result as any});
    }

    /**
     * Evaluates the given expression in the global scope.
     * @param expression        The expression to evaluate.
     * @returns                 The result.
     */
    evaluateGlobally({expression}: {expression: string}): INFOTABLE<BMDebuggerVariableResponse> {
        return DataShapes.BMDebuggerVariableResponse.CreateValuesWithData({values: BMDebuggerRuntime.evaluateExpressionGlobally(expression) as any});
    }

    /**
     * Returns details about the thrown value that caused the given thread to suspend.
     * If the thread is suspended for a reason other than a thrown value, the result is not defined.
     * @param threadID      The thread whose exception should be retrieved.
     * @returns             The exception details.
     */
    getExceptionDetails({threadID}: {threadID: number}): TWJSON<BMDebuggerExceptionResponse> {
        return (BMDebuggerRuntime.debuggerForThread(threadID)?.exceptionDetails() as any) || {
            breakMode: 'always',
            description: 'Unknown error',
            details: undefined,
            exceptionId: '0'
        };
    }

    /**
     * Sets whether the debugger should automatically break when an exception is thrown.
     * @param breaks    `true` if the debugger should suspend when an exception is thrown, `false` otherwise.
     */
    setBreakOnExceptions({breaks}: {breaks: boolean}): void {
        BMDebuggerRuntime.breaksOnException = breaks;
    }

    /**
     * Attempts to suspend the given thread. If the thread is already suspended, this method has no effect.
     * @param threadID      The ID of the thread to suspend.
     */
    suspendThread({threadID}: {threadID: number}): void {
        const runtime = BMDebuggerRuntime.debuggerForThread(threadID);
        if (runtime) {
            runtime.suspend();
        }
    }

    /**
     * Attempts to step over in the given thread. If the thread is not suspended, this method has no effect.
     * @param threadID      The ID of the thread in which to step over.
     */
    stepOverThread({threadID}: {threadID: number}): void {
        const runtime = BMDebuggerRuntime.debuggerForThread(threadID);
        if (runtime) {
            runtime.stepOver();
        }
    }

    /**
     * Attempts to step in in the given thread. If the thread is not suspended, this method has no effect.
     * @param threadID      The ID of the thread in which to step in.
     */
    stepInThread({threadID}: {threadID: number}): void {
        const runtime = BMDebuggerRuntime.debuggerForThread(threadID);
        if (runtime) {
            runtime.stepIn();
        }
    }

    /**
     * Attempts to step out in the given thread. If the thread is not suspended, this method has no effect.
     * @param threadID      The ID of the thread in which to step out.
     */
    stepOutThread({threadID}: {threadID: number}): void {
        const runtime = BMDebuggerRuntime.debuggerForThread(threadID);
        if (runtime) {
            runtime.stepOut();
        }
    }

    /**
     * Attempts to resume the given thread. If the thread is not suspended, this method has no effect.
     * @param threadID      The ID of the thread to resume.
     */
    resumeThread({threadID}: {threadID: number}): void {
        const runtime = BMDebuggerRuntime.debuggerForThread(threadID);
        if (runtime) {
            runtime.resume();
        }
    }

    /**
     * Attempts to resume all suspended threads.
     */
    resumeAllThreads(): void {
        for (const thread of this.getThreads()) {
            if (thread.state == BMDebugThreadState.Suspended) {
                this.resumeThread({threadID: thread.ID});
            }
        }
    }

    /**
     * Must be invoked by a debugger when it connects to thingworx.
     */
    connectDebugger(): void {
        BMDebuggerRuntime.connectDebugger();
    }

    /**
     * Must be invoked by a debugger when it disconnects from thingworx.
     */
    disconnectDebugger(): void {
        BMDebuggerRuntime.disconnectDebugger();
    }


}