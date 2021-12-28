const enum BMDebuggerStackTracePresentationHint {
    normal = 'normal',
    label = 'label',
    subtle = 'subtle'
}

/** 
 * A data shape that describes a stack frame returned by a stack trace request.
 */
class BMDebuggerStackTrace extends DataShapeBase {
    /** 
     * A unique identifier for this stack frame.
     */
    id!: number;

    /** 
     * The name of the stack frame, typically a function or service name. 
     */
    name!: string;

    /** 
     * The source file. 
     */
    source?: string;

    /** 
     * The line within the file of the frame. If source is null or doesn't exist, line is 0 and must be ignored. 
     */
    line!: number;

    /** 
     * The column within the line. If source is null or doesn't exist, column is 0 and must be ignored. 
     */
    column!: number;

    /** 
     * An optional hint for how to present this frame in the UI. 
     * A value of 'label' can be used to indicate that the frame is an artificial frame that is used as a visual label 
     * or separator. A value of 'subtle' can be used to change the appearance of a frame in a 'subtle' way.
     */
    presentationHint?: STRING<BMDebuggerStackTracePresentationHint>;
}