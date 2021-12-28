/**
 * Describes a response to a set breakpoints request that is communicated to the debug adapter.
 */
 class BMDebuggerBreakpointResponse extends DataShapeBase {

    /** 
     * Start line of breakpoint location. 
     */
    line!: number;

    /** 
     * Optional start column of breakpoint location. 
     */
    column?: number;

    /** 
     * Optional end line of breakpoint location if the location covers a range. 
     */
    endLine?: number;

    /** 
     * Optional end column of breakpoint location if the location covers a range. 
     */
    endColumn?: number;

    /**
     * An ID that uniquely identifies this breakpoint's location in a source file.
     */
    locationID?: string;

    /**
     * The name of the file in which this location can be found.
     */
    source?: string;

    /**
     * A unique number that identifies this breakpoint.
     */
    sequenceID?: number;

    /**
     * Set to `true` if the breakpoint could be set.
     */
    verified!: boolean;

    /**
     * An optional message to be displayed to the user if the breakpoint could not be set.
     */
    message?: string;
}