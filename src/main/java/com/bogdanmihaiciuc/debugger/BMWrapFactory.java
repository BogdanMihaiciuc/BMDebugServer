package com.bogdanmihaiciuc.debugger;

import com.thingworx.dsl.engine.adapters.Sandbox;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.WrapFactory;

/**
 * A wrap factory that allows access to classes.
 */
public class BMWrapFactory extends WrapFactory {

    private WrapFactory delegatedWrapFactory;

    BMWrapFactory(WrapFactory delegatedWrapFactory) {
        super();
        this.setJavaPrimitiveWrap(false);
        this.delegatedWrapFactory = delegatedWrapFactory;
    }

    public Object wrap(Context cx, Scriptable scope, Object obj, Class<?> staticType) {
        // For classes always use the rhino wrap factory
        if (Sandbox.isObjectBlocked(obj)) {
            return super.wrap(cx, scope, obj, staticType);
        }

        try {
            return delegatedWrapFactory.wrap(cx, scope, obj, staticType);
        }
        catch (Exception e) {
            return super.wrap(cx, scope, obj, staticType);
        }
    }

    public Scriptable wrapAsJavaObject(Context cx, Scriptable scope, Object javaObject, Class<?> staticType) {
        // If thingworx normally disallows this, allow it, otherwise delegate to the thingworx wrap factory
        if (Sandbox.isObjectBlocked(javaObject)) {
            return super.wrapAsJavaObject(cx, scope, javaObject, staticType);
        }
        else {
            return delegatedWrapFactory.wrapAsJavaObject(cx, scope, javaObject, staticType);
        }
    }

}
