package com.bogdanmihaiciuc.debugger;

import com.thingworx.metadata.annotations.ThingworxServiceDefinition;
import com.thingworx.metadata.annotations.ThingworxServiceParameter;
import com.thingworx.metadata.annotations.ThingworxServiceResult;
import com.thingworx.resources.Resource;
import com.thingworx.system.ApplicationContext;
import com.thingworx.system.ContextType;
import com.thingworx.system.ThingWorxServer;
import com.thingworx.system.subsystems.Subsystem;
import javax.websocket.server.ServerContainer;
import javax.servlet.ServletContext;
import javax.websocket.server.ServerEndpointConfig;
import org.apache.tomcat.websocket.WsWebSocketContainer;
import org.apache.tomcat.websocket.server.WsServerContainer;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.ContextFactory;
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
    BMObservingDebuggerFrame frame = this.frames.get();
    if (frame == null) {
      frame = new BMObservingDebuggerFrame();
      this.frames.set(frame);
    }

    return frame;
  }
}
