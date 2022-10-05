package com.bogdanmihaiciuc.debugger;

import com.thingworx.dsl.engine.adapters.ThingworxWrapFactory;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.debug.DebugFrame;

public class BMObservingDebuggerFrame implements DebugFrame {

  /**
   * Set to true while the javascript delegate is being notified.
   */
  private boolean isNotifying = false;

  /**
   * A delegate to which the debug notifications are forwarded.
   */
  public DebugFrame delegate;

  @Override
  public void onEnter(Context context, Scriptable activation, Scriptable thisObj, Object[] args) {
    if (context.getWrapFactory() instanceof ThingworxWrapFactory) {
      context.setWrapFactory(new BMWrapFactory(context.getWrapFactory()));
    }

    // If this is called recursively, don't process
    if (this.isNotifying) return;

    this.isNotifying = true;
    if (this.delegate != null) {
      this.delegate.onEnter(context, activation, thisObj, args);
    }
    this.isNotifying = false;
  }

  @Override
  public void onLineChange(Context context, int line) {
    // This is not needed by the delegate
  }

  @Override
  public void onExceptionThrown(Context context, Throwable throwable) {
    // If this is called recursively, don't process
    if (this.isNotifying) return;

    this.isNotifying = true;
    if (this.delegate != null) {
      this.delegate.onExceptionThrown(context, throwable);
    }
    this.isNotifying = false;
  }

  @Override
  public void onExit(Context context, boolean thrown, Object result) {
    // If this is called recursively, don't process
    if (this.isNotifying) return;

    this.isNotifying = true;
    if (this.delegate != null) {
      this.delegate.onExit(context, thrown, result);
    }
    this.isNotifying = false;
  }

  @Override
  public void onDebuggerStatement(Context context) {
    // This is not used currently
  }
}
