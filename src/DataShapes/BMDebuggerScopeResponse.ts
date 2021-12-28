/**
 * A shape that describes the response of a scopes request.
 */
class BMDebuggerScopeResponse extends DataShapeBase {
    /** Name of the scope such as 'Arguments', 'Locals', or 'Registers'. This string is shown in the UI as is and can be translated. */
    name!: string;
    /** An optional hint for how to present this scope in the UI. If this attribute is missing, the scope is shown with a generic UI.
        Values:
        'arguments': Scope contains method arguments.
        'locals': Scope contains local variables.
        'registers': Scope contains registers. Only a single 'registers' scope should be returned from a 'scopes' request.
        etc.
    */
    presentationHint?: string;
    /** The variables of this scope can be retrieved by passing the value of variablesReference to the VariablesRequest. */
    variablesReference!: number;
    /** The number of named variables in this scope.
        The client can use this optional information to present the variables in a paged UI and fetch them in chunks.
    */
    namedVariables!: number;
    /** The number of indexed variables in this scope.
        The client can use this optional information to present the variables in a paged UI and fetch them in chunks.
    */
    indexedVariables!: number;

    expensive!: boolean;
}