/**
 * Describes a breakpoint location that is communicated to the debug adapter.
 */
class BMDebuggerBreakpointLocation extends DataShapeBase {

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
    @primaryKey locationID!: string;

    /**
     * The name of the file in which this location can be found.
     */
    fileName?: string;
}