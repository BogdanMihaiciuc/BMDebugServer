package com.bogdanmihaiciuc.debugger;

import com.thingworx.system.subsystems.users.UserManagementSubsystem;
import java.io.IOException;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import javax.websocket.CloseReason;
import javax.websocket.CloseReason.CloseCodes;
import javax.websocket.OnClose;
import javax.websocket.OnError;
import javax.websocket.OnMessage;
import javax.websocket.OnOpen;
import javax.websocket.Session;
import javax.websocket.server.ServerEndpoint;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Provides a websocket endpoint though which the debug runtime can send messages
 * to attached debuggers.
 */
@ServerEndpoint(value = "/ThingworxDebugger")
public class BMObservingDebuggerEndpoint {

    /**
     * A set of sessions that have connected but not yet authenticated.
     */
    private static final Set<Session> pendingSessions = Collections.synchronizedSet(new HashSet<>());

    /**
     * The sessions that have authenticated.
     */
    private static final Set<Session> authenticatedSessions = Collections.synchronizedSet(new HashSet<>());

    /**
     * Controls whether clients are allowed to connect to this endpoint.
     */
    private static boolean _started = false;

    /**
     * Allows clients to connect to this endpoint.
     */
    public static void start() {
        _started = true;
    }

    /**
     * Disconnects all active sessions and prevents clients from connecting to this endpoint.
     */
    public static void stop() {
        _started = false;

        Set<Session> allSessions = new HashSet<>();
        allSessions.addAll(pendingSessions);
        allSessions.addAll(authenticatedSessions);

        for (Session session : allSessions) {
            //noinspection SynchronizationOnLocalVariableOrMethodParameter
            synchronized (session) {
                try {
                    session.close(new CloseReason(CloseCodes.SERVICE_RESTART, "The endpoint is no longer active."));
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
        }
    }

    @OnOpen
    public void onOpen(Session session) {
        if (!_started) {
            try {
                session.close(new CloseReason(CloseCodes.CANNOT_ACCEPT, "The endpoint is not active."));
            } catch (IOException ioException) {
                ioException.printStackTrace();
            }
        }

        // Move the session into pending
        pendingSessions.add(session);
    }

    @OnClose
    public void onClose(Session session) {
        pendingSessions.remove(session);
        authenticatedSessions.remove(session);
    }

    @OnMessage
    public void onMessage(String message, Session session) {
        //noinspection SynchronizationOnLocalVariableOrMethodParameter
        synchronized (session) {
            // If the session isn't authenticated, the message must be an authentication request
            // otherwise the session will be closed
            if (pendingSessions.contains(session)) {
                try {
                    JSONObject payload = new JSONObject(message);
                    String appKey = payload.getString("appKey");

                    // Verify if the provided key is valid
                    boolean valid = UserManagementSubsystem.getSubsystemInstance().DoesApplicationKeyWithKeyIdExist("Administrator", appKey);

                    if (valid) {
                        // TODO: If the key exists, verify that it is not expired
                        authenticatedSessions.add(session);
                        pendingSessions.remove(session);

                        // If authentication is successful, send a confirmation message
                        JSONObject responseObject = new JSONObject();
                        responseObject.put("authenticated", true);
                        session.getBasicRemote().sendText(responseObject.toString());
                    }
                    else {
                        throw new IllegalArgumentException("Invalid application key provided.");
                    }
                }
                catch (Exception e) {
                    try {
                        session.close(new CloseReason(CloseCodes.CANNOT_ACCEPT, "Unknown message sent by unauthenticated session."));
                    } catch (IOException ioException) {
                        ioException.printStackTrace();
                    }
                }
            }
            else if (authenticatedSessions.contains(session)) {
                // Authenticated sessions shouldn't send any messages
                try {
                    session.close(new CloseReason(CloseCodes.CANNOT_ACCEPT, "Unknown message sent by authenticated session."));
                } catch (IOException ioException) {
                    ioException.printStackTrace();
                }
            }
        }
    }

    @OnError
    public void onError(Throwable t) {
        System.out.println("onError::" + t.getMessage());
    }

    /**
     * Sends a message to all open sessions.
     * @param message   The message to send.
     */
    public static void broadcastMessage(String message) {
        if (!_started) return;

        for (Session s : authenticatedSessions) {
            //noinspection SynchronizationOnLocalVariableOrMethodParameter
            synchronized (s) {
                if (s.isOpen()) {
                    try {
                        s.getBasicRemote().sendText(message);
                    } catch (IOException e) {
                        e.printStackTrace();
                    }
                }
            }
        }
    }

}
