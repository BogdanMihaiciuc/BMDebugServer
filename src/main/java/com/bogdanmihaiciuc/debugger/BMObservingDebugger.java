package com.bogdanmihaiciuc.debugger;

import com.thingworx.dsl.engine.adapters.ThingworxWrapFactory;
import com.thingworx.metadata.annotations.ThingworxServiceDefinition;
import com.thingworx.metadata.annotations.ThingworxServiceParameter;
import com.thingworx.metadata.annotations.ThingworxServiceResult;
import com.thingworx.resources.Resource;
import com.thingworx.system.ApplicationContext;
import com.thingworx.system.ContextType;
import com.thingworx.system.ThingWorxServer;
import com.thingworx.system.subsystems.Subsystem;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import javax.websocket.server.ServerContainer;
import javax.servlet.ServletContext;
import javax.websocket.server.ServerEndpointConfig;
import org.apache.tomcat.websocket.WsWebSocketContainer;
import org.apache.tomcat.websocket.server.WsServerContainer;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.ContextFactory;
import org.mozilla.javascript.ScriptableObject;
import org.mozilla.javascript.debug.DebugFrame;
import org.mozilla.javascript.debug.DebuggableScript;
import org.mozilla.javascript.debug.Debugger;

/**
 * A resource that implements an observing debugger that is used by the debugger runtime
 * to obtain information about running services.
 */
public class BMObservingDebugger extends Subsystem implements ContextFactory.Listener, Debugger {

  private static boolean endpointInitialized = false;

  public ThreadLocal<BMObservingDebuggerFrame> frames = new ThreadLocal<>();

  /**
   * Returns the scriptable object class.
   */
  public static Method getParentScopeMethod() throws Exception {
    return ScriptableObject.class.getDeclaredMethod("getParentScope");
  }

  /**
   * Tests whether the specified object is an instance of the ScriptableObject class.
   * @param object    The object to test.
   * @return          `true` if the object is an instance, `false` otherwise.
   */
  public static boolean isScriptableInstance(Object object) throws Exception {
    return ScriptableObject.class.isInstance(object);
  }

  @Override
  protected void startSubsystem(ContextType contextType) throws Exception {
    super.startSubsystem(contextType);

    ContextFactory.getGlobal().addListener(this);

    if (!endpointInitialized) {
      ServletContext context = ApplicationContext.getInstance().getServletContext();
      WsServerContainer container = (WsServerContainer) context.getAttribute("javax.websocket.server.ServerContainer");
      container.addEndpoint(BMObservingDebuggerEndpoint.class);
      endpointInitialized = true;
    }

    BMObservingDebuggerEndpoint.start();
  }

  @Override
  public void stopSubsystem(ContextType contextType) throws Exception {
    super.stopSubsystem(contextType);
    ContextFactory.getGlobal().removeListener(this);

    BMObservingDebuggerEndpoint.stop();
  }

  @ThingworxServiceDefinition(name = "InitStandardObjects", description = "Initializes the standard objects that allow the debugger runtime to access java classes.")
  @ThingworxServiceResult(
      name = "result",
      baseType = "NOTHING"
  )
  public void InitStandardObjects() throws Exception {
    Context context = Context.getCurrentContext();

    Field topCallField = Context.class.getDeclaredField("topCallScope");
    topCallField.setAccessible(true);


    ScriptableObject topCall = (ScriptableObject) topCallField.get(context);
    context.initStandardObjects(topCall);

    // Stop thingworx from denying access to classes
    BMWrapFactory wrapFactory = new BMWrapFactory(context.getWrapFactory());
    context.setWrapFactory(wrapFactory);
  }

  @ThingworxServiceDefinition(name = "SendMessage", description = "Sends a message to the clients connected to the debugger endpoint.")
  @ThingworxServiceResult(
      name = "result",
      baseType = "NOTHING"
  )
  public void SendMessage(@ThingworxServiceParameter(name = "message", baseType = "STRING") String message) {
    BMObservingDebuggerEndpoint.broadcastMessage(message);
  }

  @Override
  public void contextCreated(Context context) {
    if (context.getWrapFactory() instanceof ThingworxWrapFactory) {
      context.setWrapFactory(new BMWrapFactory(context.getWrapFactory()));
    }
    
    context.setOptimizationLevel(-1);
    context.setGeneratingDebug(true);
    context.setDebugger(this, new Object());
  }

  @Override
  public void contextReleased(Context context) {
    context.setDebugger(null, null);
  }

  @Override
  public void handleCompilationDone(Context context, DebuggableScript debuggableScript, String s) {
    // This is not observed by the debugger
  }

  @Override
  public DebugFrame getFrame(Context context, DebuggableScript debuggableScript) {
    if (context.getWrapFactory() instanceof ThingworxWrapFactory) {
      context.setWrapFactory(new BMWrapFactory(context.getWrapFactory()));
    }

    BMObservingDebuggerFrame frame = this.frames.get();
    if (frame == null) {
      frame = new BMObservingDebuggerFrame();
      this.frames.set(frame);
    }

    return frame;
  }
}
