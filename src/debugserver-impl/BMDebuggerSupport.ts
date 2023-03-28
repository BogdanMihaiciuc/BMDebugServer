/**
 * An interface that describes a restricted scope which is not exposed by the debugger runtime.
 */
interface BMDebuggerRestrictedScope {
    kind: BMDebuggerScopeKind.Restricted;
}

/**
 * An interface that describes a javascript scope within a service.
 */
interface BMDebuggerServiceScope {
    kind: BMDebuggerScopeKind.Service;

    /**
     * The activation object containing the variables and functions declared in the scope.
     */
    activationObject: any;

    /**
     * The context object, representing the value of the `this` reference.
     */
    contextObject: any;

    /**
     * The arguments with which the function was invoked.
     */
    arguments: any[];

    /**
     * A unique number identifying this scope, which is used when evaluating javascript
     * in specific stack elements.
     */
    id: number;

    /**
     * The current line.
     */
    line: number;

    /**
     * The current column.
     */
    column: number;

    /**
     * The name of the function.
     */
    name: string;

    /**
     * The name of the file in which this function was originally defined.
     */
    filename: string;
}


/**
 * An interface that describes the debug information available for a service.
 */
interface BMDebuggerService {
    /**
     * The name of the service.
     */
    name: string;

    /**
     * The VSCode filename where the service was defined.
     */
    filename: string;

    /**
     * The current line number in this service.
     */
    line: number;

    /**
     * The current column number in this service, if available.
     * If column numbers aren't supported this value will always be 0.
     */
    column: number;

    /**
     * The stack of scopes that have been entered in this service.
     */
    scopeStack: (BMDebuggerRestrictedScope | BMDebuggerServiceScope)[];
}

/** A Stackframe contains the source location. */
interface BMDebuggerStackFrame {
    /** An identifier for the stack frame. It must be unique across all threads.
        This id can be used to retrieve the scopes of the frame with the 'scopesRequest' or to restart the execution of a stackframe.
    */
    id: number;
    /** The name of the stack frame, typically a method name. */
    name: string;
    /** The optional source of the frame. */
    source?: string;
    /** The line within the file of the frame. If source is null or doesn't exist, line is 0 and must be ignored. */
    line: number;
    /** The column within the line. If source is null or doesn't exist, column is 0 and must be ignored. */
    column: number;
    /** An optional hint for how to present this frame in the UI.
        A value of 'label' can be used to indicate that the frame is an artificial frame that is used as a visual label or separator. A value of 'subtle' can be used to change the appearance of a frame in a 'subtle' way.
    */
    presentationHint?: BMDebuggerStackTracePresentationHint;
}

/**
 * An object that describes a command that can be sent to a debugger.
 */
interface BMDebuggerCommand {

    /**
     * The kind of command.
     */
    kind: BMDebuggerCommandKind;
}

/**
 * An interface that describes the step out command and its arguments.
 */
interface BMDebuggerStepOutCommand extends BMDebuggerCommand {
    kind: BMDebuggerCommandKind.StepOut;

    /**
     * The activation object to step out of.
     */
    activationObject: any;
}

/**
 * An interface that describes the step over command and its arguments.
 */
interface BMDebuggerStepOverCommand extends BMDebuggerCommand {
    kind: BMDebuggerCommandKind.Step;

    /**
     * The activation object to step over in.
     */
    activationObject: any;
}

/**
 * An interface that describes an evaluate command and its arguments.
 */
interface BMDebuggerEvaluateCommand extends BMDebuggerCommand {
    kind: BMDebuggerCommandKind.Evaluate;

    /**
     * The expression to evaluate.
     */
    expression: string;

    /**
     * The stack frame in which to evaluate.
     */
    frameID: number;

    /**
     * A lock that should be acquired when evaluating.
     */
    lock: Lock;

    /**
     * A condition that should be signaled when evaluation completes.
     */
    condition: Condition;

    /**
     * Set to `true` when the evaluation completes.
     */
    finished: boolean;

    /**
     * The result of evaluating the expression.
     */
    result?: any;
}

/**
 * An interface that describes the suspend command and its arguments.
 */
interface BMDebuggerSuspendCommand extends BMDebuggerCommand {
    kind: BMDebuggerCommandKind.Suspend;

    /**
     * The reason for which this suspend was requested.
     */
    reason: BMDebuggerSuspendReason;

    /**
     * Additional arguments based on the suspension reason.
     */
    args: any[];
}

/**
 * An interface that describes a breakpoint.
 */
interface BMDebuggerBreakpoint {

    /**
     * A unique identifier for this breakpoint.
     */
    id: string;

    /**
     * A unique sequence number that identifies this breakpoint.
     */
    sequenceID?: number;

    /**
     * The path of the original source file in which breakpoint was set.
     */
    sourceFile: string;

    /**
     * The line number in the original source file where the breakpoint was set.
     */
    line: number;

    /**
     * If specified, the column number in the original source file where the breakpoint was set.
     */
    column?: number;

    /**
     * If specified, the line number where the statement affected by this breakpoint ends.
     */
    endLine?: number;

    /**
     * If specified, the column number where the statement affected by this breakpoint ends.
     */
    endColumn?: number;

    /**
     * Set to `true` if the breakpoint could be activated. Only included in the response of setting breakpoints.
     */
    verified?: boolean;

    /**
     * An optional javascript condition that, when set, must evaluate to `true` in order to trigger the breakpoint.
     */
    condition?: string;

    /**
     * Set to `true` if the breakpoint is active and should suspend execution.
     */
    active: boolean;
}

/**
 * The interface for an object that contains the breakpoints to be activated.
 */
interface BMDebuggerSetBreakpointsRequest {

    /**
     * The breakpoints to be activated.
     */
    breakpoints: BMDebuggerSourceBreakpoint[];
}

interface BMDebuggerSourceBreakpoint {
    /** The source line of the breakpoint or logpoint. */
    line: number;
    /** An optional source column of the breakpoint. */
    column?: number;
    /** An optional expression for conditional breakpoints.
        It is only honored by a debug adapter if the capability 'supportsConditionalBreakpoints' is true.
    */
    condition?: string;
    /** An optional expression that controls how many hits of the breakpoint are ignored.
        The backend is expected to interpret the expression as needed.
        The attribute is only honored by a debug adapter if the capability 'supportsHitConditionalBreakpoints' is true.
    */
    hitCondition?: string;
    /** If this attribute exists and is non-empty, the backend must not 'break' (stop)
        but log the message instead. Expressions within {} are interpolated.
        The attribute is only honored by a debug adapter if the capability 'supportsLogPoints' is true.
    */
    logMessage?: string;
}

/** A Scope is a named container for variables. Optionally a scope can map to a source or a range within a source. */
interface BMDebuggerScope {
    /** Name of the scope such as 'Arguments', 'Locals', or 'Registers'. This string is shown in the UI as is and can be translated. */
    name: string;
    /** An optional hint for how to present this scope in the UI. If this attribute is missing, the scope is shown with a generic UI.
        Values:
        'arguments': Scope contains method arguments.
        'locals': Scope contains local variables.
        'registers': Scope contains registers. Only a single 'registers' scope should be returned from a 'scopes' request.
        etc.
    */
    presentationHint?: 'arguments' | 'locals' | 'registers' | string;
    /** The variables of this scope can be retrieved by passing the value of variablesReference to the VariablesRequest. */
    variablesReference: number;
    /** The number of named variables in this scope.
        The client can use this optional information to present the variables in a paged UI and fetch them in chunks.
    */
    namedVariables?: number;
    /** The number of indexed variables in this scope.
        The client can use this optional information to present the variables in a paged UI and fetch them in chunks.
    */
    indexedVariables?: number;

    expensive: false;
}


/** A Variable is a name/value pair.
    Optionally a variable can have a 'type' that is shown if space permits or when hovering over the variable's name.
    An optional 'kind' is used to render additional properties of the variable, e.g. different icons can be used to indicate that a variable is public or private.
    If the value is structured (has children), a handle is provided to retrieve the children with the VariablesRequest.
    If the number of named or indexed children is large, the numbers should be returned via the optional 'namedVariables' and 'indexedVariables' attributes.
    The client can use this optional information to present the children in a paged UI and fetch them in chunks.
*/
interface BMDebuggerVariable {
    /** The variable's name. */
    name: string;
    /** The variable's value. This can be a multi-line text, e.g. for a function the body of a function. */
    value: string;
    /** The type of the variable's value. Typically shown in the UI when hovering over the value.
        This attribute should only be returned by a debug adapter if the client has passed the value true for the 'supportsVariableType' capability of the 'initialize' request.
    */
    type?: string;
    /** Properties of a variable that can be used to determine how to render the variable in the UI. */
    presentationHint: BMDebuggerVariablePresentationHint;
    /** Optional evaluatable name of this variable which can be passed to the 'EvaluateRequest' to fetch the variable's value. */
    evaluateName?: string;
    /** If variablesReference is > 0, the variable is structured and its children can be retrieved by passing variablesReference to the VariablesRequest. */
    variablesReference: number;
    /** The number of named child variables.
        The client can use this optional information to present the children in a paged UI and fetch them in chunks.
    */
    namedVariables?: number;
    /** The number of indexed child variables.
        The client can use this optional information to present the children in a paged UI and fetch them in chunks.
    */
    indexedVariables?: number;
    /** Optional memory reference for the variable if the variable represents executable code, such as a function pointer.
        This attribute is only required if the client has passed the value true for the 'supportsMemoryReferences' capability of the 'initialize' request.
    */
    memoryReference?: string;
}

/** Optional properties of a variable that can be used to determine how to render the variable in the UI. */
interface BMDebuggerVariablePresentationHint {
    /** The kind of variable. Before introducing additional values, try to use the listed values.
        Values:
        'property': Indicates that the object is a property.
        'method': Indicates that the object is a method.
        'class': Indicates that the object is a class.
        'data': Indicates that the object is data.
        'event': Indicates that the object is an event.
        'baseClass': Indicates that the object is a base class.
        'innerClass': Indicates that the object is an inner class.
        'interface': Indicates that the object is an interface.
        'mostDerivedClass': Indicates that the object is the most derived class.
        'virtual': Indicates that the object is virtual, that means it is a synthetic object introducedby the
        adapter for rendering purposes, e.g. an index range for large arrays.
        'dataBreakpoint': Deprecated: Indicates that a data breakpoint is registered for the object. The 'hasDataBreakpoint' attribute should generally be used instead.
        etc.
    */
    kind: 'property' | 'method' | 'class' | 'data' | 'event' | 'baseClass' | 'innerClass' | 'interface' | 'mostDerivedClass' | 'virtual' | 'dataBreakpoint' | string;
    /** Set of attributes represented as an array of strings. Before introducing additional values, try to use the listed values.
        Values:
        'static': Indicates that the object is static.
        'constant': Indicates that the object is a constant.
        'readOnly': Indicates that the object is read only.
        'rawString': Indicates that the object is a raw string.
        'hasObjectId': Indicates that the object can have an Object ID created for it.
        'canHaveObjectId': Indicates that the object has an Object ID associated with it.
        'hasSideEffects': Indicates that the evaluation had side effects.
        'hasDataBreakpoint': Indicates that the object has its value tracked by a data breakpoint.
        etc.
    */
    attributes: ('static' | 'constant' | 'readOnly' | 'rawString' | 'hasObjectId' | 'canHaveObjectId' | 'hasSideEffects' | 'hasDataBreakpoint' | string)[];
    /** Visibility of variable. Before introducing additional values, try to use the listed values.
        Values: 'public', 'private', 'protected', 'internal', 'final', etc.
    */
    visibility: 'public' | 'private' | 'protected' | 'internal' | 'final' | string;
}

interface BMDebuggerExceptionResponse {
    /** ID of the exception that was thrown. */
    exceptionId: string;
    /** Descriptive text for the exception provided by the debug adapter. */
    description?: string;
    /** Mode that caused the exception notification to be raised.
     * This enumeration defines all possible conditions when a thrown exception should result in a break.
    never: never breaks,
    always: always breaks,
    unhandled: breaks when exception unhandled,
    userUnhandled: breaks if the exception is not handled by user code.
     */
    breakMode: 'never' | 'always' | 'unhandled' | 'userUnhandled';
    /** Detailed information about the exception. */
    details?: BMDebuggerExceptionDetails;
}

/** Detailed information about an exception that has occurred. */
interface BMDebuggerExceptionDetails {
    /** Message contained in the exception. */
    message?: string;
    /** Short type name of the exception object. */
    typeName?: string;
    /** Fully-qualified type name of the exception object. */
    fullTypeName?: string;
    /** Optional expression that can be evaluated in the current scope to obtain the exception object. */
    evaluateName?: string;
    /** Stack trace at the time the exception was thrown. */
    stackTrace?: string;
    /** Details of the exception contained by this exception, if any. */
    innerException?: BMDebuggerExceptionDetails[];
}

interface BMDebuggerError extends Error {
    rhinoException?: any;
}

/**
 * The base interface for a message that is sent to attached debuggers via a websocket connection.
 */
interface BMDebuggerMessage {

    /**
     * The name of the message.
     */
    name: string;
}

/**
 * The interface for a message that is sent to attached debuggers when any thread
 * suspends.
 */
interface BMDebuggerSuspendMessage extends BMDebuggerMessage {
    name: 'suspended',

    /**
     * The ID of the thread that was suspended.
     */
    threadID: number;

    /**
     * A string that provides a message to the user explaining why the thread was suspended.
     */
    reason: string;

    /**
     * If the thread suspends due to a thrown value, this field contains a message indicating what was thrown.
     */
    exception?: string;
}

/**
 * The interface for a message that is sent to attached debuggers when any thread
 * resumes execution.
 */
interface BMDebuggerResumedMessage extends BMDebuggerMessage {
    name: 'resumed',

    /**
     * The ID of the thread that was suspended.
     */
    threadID: number;
}

/**
 * The interface for a message that is sent to attached debuggers when any thread
 * logs a message.
 */
interface BMDebuggerLogMessage extends BMDebuggerMessage {
    name: 'log',

    /**
     * The message to be logged.
     */
    body: string;

    /**
     * The log level.
     */
    level: number;
}