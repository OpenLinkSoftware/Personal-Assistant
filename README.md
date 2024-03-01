# OpenLink Personal Assistant (OpenAI Chat client)


The OpenAI provides API to exploit many features of LLM, one of these is GPT chat models. In order to customise the chat completion via persistent initialisation prompts combined with PL callback to instruct LLM to provide better answers we implement chat application allowing to make custom Sales & Tech Support  assistants as well as possible other of such a type.  

Note: further for brevity we use `OAI` for [OpenAI API](https://platform.openai.com/docs/api-reference), do not confuse with [Open API](https://spec.openapis.org/oas/latest.html) (`OAS`) specification

## Implementation

The application is built on base of PL wrappers for calling OAI REST endpoint, requests(prompt,question) and responses(answers) are stored in a chat session table, in case of function callback asked, it is called with supplied arguments. In other words the server-side backend is in charge to maintain the chat prompts and compose proper request/response flow to OAI endpoint, as well as to the user interface. 
The user interface is pure Javascript & CSS client used to authenticate & connect to the backend and upon approval to ask questions where can specify initial prompt, function callbacks, LLM model.

###  Server-Side

  - OpenAI API PL wrappers
     The OAI rest interface is described via [Open API YAML document](https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml) 
 - [Server-sent events (SSE)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) (stream mode) client, which we import using `OAS_IMPORT()` function to create SQL script (see below). Further from this script we take wrapper `createChatCompletion()` and modify so that it can call OAI to return Server-sent events (SSE). The last is needed because OAS document do not describe SSE responses.  
  Note: We choose to use SSE (streaming) to receive answers because LLM takes quite a bit of time ~10s or more to complete most of prompts, therefore for better user experience we act like a proxy where upon receiving the answer we send tokens back via Websocket to client UI, in same time we keep reading so that when answer is received to store in the chat session table.
 
  - [Websockets](https://datatracker.ietf.org/doc/html/rfc6455) service (WS)
    The WSS was chosen as protocol to maintain chat session because of full-duplex capabilities. It's stored procedure entry is used to maintain the OAI chat protocol and to keep chat session intact. 

  - VAL authentication & authorisation 
   self-explanatory

  - REST helpers interface
   As Javascript OAuth2 client library do not support  [WebSockets API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API), as well as for UI tasks like editing titles, deleting chat sessions etc. is easiest to implement using fetch() via OAuth2 client, we provide few API calls for chat sessions management.
 
### Client UI 

  The client UI is implemented using following components:

  - jQuery 3.7
  - Bootstrap 3.4 
  - Solid OAuth (build from OpenLink fork, version???)

## Manual installation and configuration

  - Checkout code
   ```
   $ git clone git@devhub.openlinksw.com:public/imitko/oai-chat
   ```
  - create config.js (optional)
   ```
   $ cp config.js.example config.js
   $ cat config.js
   var wsServer='wss://localhost:8443/ws/chat';
   var httpServer='https://localhost:8443';
   ```
   edit the above file and set proper host name and port number of the Virtuoso Server designated to host the chat back-end

   - edit `sql/vd.sql` script and fix the `lhost` & `vhost` arguments
   - execute via command-line `isql` tool the scripts in following order:

     - sql/openai-3-0.sql  (OAI wrappers)
     - sql/ddl.sql (tables)
     - sql/bpe.sql (tokens encoder)
     - sql/chat.sql (backend)
     - sql/vd.sql (virtual paths)
     - install VAL VAD package and configure to accept basic NetIds (see VAL documentation for details)
     - execute sql/chat_acl_rules.sql (ACL rules)
     - optionally can execute `sql/func.sql` to define PL call back for OAI Chat
     - go to https://host/chat/ to open client interface
   
   **IMPORTANT**:  The application is designed & implemented to use OAuth2 for authentication & authorisation, thus **CAN NOT** use HTTP insecure host, therefore must define virtual directories (vd.sql) on secure listener.

