# 1.2

Resolves an issue that caused thrown value details to not be correctly reported on Thingworx 9.3.4 or later.

Resolves an issue where the filename of global functions was not properly reported.

Adds support for breaking only on caught or uncaught thrown values in addition to any thrown values.

After continuing following a break on an exception, the debugger will no longer stop for each subsequent service on that same exception.

# 1.1.1

Compatibility with Thingworx 9.3.4. This release should not be used on prior versions of Thingworx.

# 1.1

The debugger will now report the content of objects of the following types:
 - `org.json.JSONObject`
 - `org.json.JSONArray`
 - `com.thingworx.dsl.engine.adapters.JSONArrayAdapter`
 - `com.thingworx.dsl.engine.adapters.JSONObjectAdapter`
 - `com.thingworx.dsl.engine.adapters.ThingworxInfoTableAdapter`
 - `com.thingworx.metadata.DataShapeDefinition`
 - `com.thingworx.metadata.collections.FieldDefinitionCollection`
 - `com.thingworx.metadata.FieldDefinition`
 - `com.thingworx.types.collections.AspectCollection`
 - `com.thingworx.types.BaseTypes`