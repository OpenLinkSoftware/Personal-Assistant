/*
 *  $Id$
 *
 *  This file is part of the OpenLink Software Virtuoso Open-Source (VOS)
 *  project.
 *
 *  Copyright (C) 1998-2023 OpenLink Software
 *
 *  This project is free software; you can redistribute it and/or modify it
 *  under the terms of the GNU General Public License as published by the
 *  Free Software Foundation; only version 2 of the License, dated June 1991.
 *
 *  This program is distributed in the hope that it will be useful, but
 *  WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 *  General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License along
 *  with this program; if not, write to the Free Software Foundation, Inc.,
 *  51 Franklin St, Fifth Floor, Boston, MA 02110-1301 USA
 *
 */

var md = window.markdownit({
       html:false,
       breaks:true,
       linkify:true,
       langPrefix:'language-',
       highlight: function (str, lang) {
       if (lang && hljs.getLanguage(lang)) {
           try {
               return '<pre class="hljs"><code>' +
                   hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
                   '</code></pre>';
           } catch (__) {}
       }
           return '<pre class="hljs"><code>' + self.md.utils.escapeHtml(str) + '</code></pre>';
       }
});

var clipboard = new ClipboardJS('.clipboard', {
    target: function(trigger) {
        return trigger.nextElementSibling;
    }
});

(function () {
    var chatDebug = false;
    var Message;
    Message = function (arg) {
        this.text = arg.text, this.message_side = arg.message_side, this.title = arg.title;
        this.draw = function (_this) {
            return function () {
                var $message;
                if (_this.message_side === 'middle') {
                    var $button, $text, $args;
                    let id = Math.random().toString(36).replace('0.','fnm-');
                    $message = $($('.fn_template').clone().html());
                    $message.addClass(_this.message_side);
                    if (!$('#fn-debug').is(':checked')) {
                        $message.addClass('d-none');
                    }
                    $button = $message.find('.accordion-button');
                    $text = $message.find('.text');
                    $args = $text.find('.args');
                    $text.attr('id', id);
                    $button.attr('data-bs-target', '#'+id);
                    $button.children('.fnb_text').html(_this.title);
                    $args.html(md.render(_this.text));

                } else {
                    $message = $($('.message_template').clone().html());
                    $message.addClass(_this.message_side).find('.text').html(md.render(_this.text));
                }
                _this.currentAnswer = $message.find('.text');
                $('.messages').append($message);
                return setTimeout(function () {
                    return $message.addClass('appeared');
                }, 0);
            };
        }(this);
        return this;
    };
    $(function () { /* document ready */
        var getMessageText, sendMessage, onOpen, onMessage, onError, onClose, webSocket, readMessage;
        var authClient = solidClientAuthentication.default;
        var url = new URL(wsServer); /* WebSockets endpoint */
        var helloSent = false; /* flag to send "hello* message */
        var lastChatId = null /* last user chat to add new items before */, currentChatId = null;
        var currentModel = 'gpt-4';
        var temperature = 0.2;
        var top_p = 0.5;
        var receivingMessage = null; /* this is not null when receiving response, keeps object which present current answer */
        var enabledCallbacks = [];
        var markdown_content = $('#markdown-content');
        var loggedIn = false;
        var apiKeyRequired = true;
        var apiKey = null;
        var lastSearch = '';
        var ftSearch = false;
        var chatTopicsCache = [];
        var session = authClient.getDefaultSession();
        /* next are for login gizmo */
        var pageParams = new URLSearchParams(new URL(document.location).search);
        var plink = pageParams.get('chat_id');
        loggedIn = false;

        session.onLogin(function() {
            loggedIn = (session && session.info && session.info.isLoggedIn);
            updateLoginState();
            if (session.info.webId != null)
                showNotice ('Logged as ' + session.info.webId);
        });
        /*
        session.onLogout(function() {
            console.log('logged-out:'+session.info.isLoggedIn);
        });*/

        $('#loginID').click(authLogin);
        $('#logoutID').click(authLogout);

        getMessageText = function () {
            var $message_input;
            $message_input = $('.message_input');
            return $message_input.val();
        };

        /* used to write R/L on chat window only */
        sendMessage = function (text, message_side, scroll = true, title = null) {
            var $messages, message;
            if (text.trim() === '') {
                return;
            }
            $('.message_input').val('');
            $messages = $('.messages');
            message = new Message({
                text: text,
                message_side: message_side,
                currentAnswer: null,
                title: title
            });
            message.draw();
            if (null != message.currentAnswer)
                message.currentAnswer.find('a').attr('target','_blank');
            if (scroll)
              $messages.animate({ scrollTop: $messages.prop('scrollHeight') }, 300);
            return message.currentAnswer;
        };

        function updateShareLink() {
            let url = new URL(document.location);
            let params = new URLSearchParams();
            params.append('chat_id', currentChatId);
            url.search = params.toString();
            $('.share-btn').attr ('href', url.toString());
        }

        function cancelContinueAction () {
            receivingMessage = null;
            markdown_content.html('');
            $('.continue_wrapper').hide();
        }

        /* associate WS connection with OAuah session and set the chat id if any server side */
        async function chatAuthenticate () {
            try {
                let url = new URL('/chat/api/chatAuthenticate', httpServer);
                let params = new URLSearchParams(url.search);
                params.append('session_id', session.info.sessionId);
                if (null != currentChatId)
                    params.append('chat_id', currentChatId);
                url.search = params.toString();
                const resp = await authClient.fetch (url.toString());
                if (resp.ok) {
                    let obj = await resp.json();
                    apiKeyRequired = obj.apiKeyRequired;
                    if (!apiKeyRequired) {
                      $('.key-icon').attr('src', 'svg/unlock.svg');
                      $('#api-key-modal-btn').attr('href', '#');
                      $('#api-key-modal-btn').click(function(e){e.preventDefault();});
                      $('#api-key-modal-btn span').tooltip('dispose');
                      $('#api-key-modal-btn span').attr('title', 'API Key is already set on this system.');
                      $('#api-key-modal-btn span').tooltip();
                    } else {
                        $('#api-key-modal').modal('show');
                    }
                } else {
                    showNotice ('Can not authenticate chat session' + resp.statusText);
                    await authLogout();
                }
            } catch (e) {
                console.log('Error:' + e);
                showNotice('Can not authenticate ' + e);
                await authLogout();
            }
        }

        async function getCurrentChatId () {
            /* here we should current chat if new */
            try {
                let url = new URL('/chat/api/getTopic', httpServer);
                let params = new URLSearchParams(url.search);
                params.append('session_id', session.info.sessionId);
                url.search = params.toString();
                const resp = await authClient.fetch (url.toString());
                if (resp.status === 200) {
                    let chat = await resp.json();
                    /*console.log('resp:' + JSON.stringify(chat));*/
                    const chat_id = chat.chat_id;
                    const title = chat.title;
                    const funcs = chat.funcs;
                    const model = chat.model;
                    temperature = chat.temperature;
                    top_p = chat.top_p;
                    addSidebarItem (chat_id, title, 'now', lastChatId);
                    currentChatId = chat_id;
                    setModel (model);
                    if (funcs instanceof Array) {
                       funcs.forEach (function(item) {
                           if (-1 == enabledCallbacks.indexOf(item))
                               enabledCallbacks.push(item);
                       });
                       if (enabledCallbacks.length) {
                           $('#fn-count').html(`[${enabledCallbacks.length}]`).show();
                       }
                    }
                    updateShareLink();
                } else {
                    showNotice ('Can not retrieve chatId ' + resp.statusText);
                }
            } catch (e) {
                showNotice('Can not getTopic ' + e);
            }
        }

        /* used to write WSock responses in chat */
        readMessage = function (input) {
          let obj = JSON.parse(input);
          let text = obj.data;
          let kind = obj.kind;
          let $messages = $('.messages');

          if ('function' === kind) {
              let func_call = JSON.parse (text);
              let title = 'Function: <b>' + func_call.func_title + '</b> ('+ func_call.func + ')';
              let div = '\n**Arguments:**\n```json\n' + func_call.func_args + '\n```';
              sendMessage (div, 'middle', false, title);
              $messages.animate({ scrollTop: $messages.prop('scrollHeight') }, 300);
              $('.loader').show();
              $('.stop_wrapper').show();
              receivingMessage = null;
          } else if ('function_response' === kind) {
              let $li = $('.messages .middle').last();
              let $res = $li.find('.result');
              if (text.length > 1) {
                  $res.html (md.render ('**Result:**\n```\n'+text+'\n```'));
              } else {
                  $res.html ('<b>N/A</b>');
              }
              $messages.animate({ scrollTop: $messages.prop('scrollHeight') }, 300);
              $('.loader').show();
              receivingMessage = null;
          } else if (text.trim() === '[DONE]' || text.trim() === '[LENGTH]') {
              // make target
              if (null != receivingMessage) {
                  receivingMessage.find('a').attr('target','_blank');
              }
              if (text.trim() === '[LENGTH]') {
                  $('.continue_wrapper').show();
              } else { /* [DONE] */
                  receivingMessage = null;
                  markdown_content.html('');
                  $('.continue_wrapper').hide();
              }
              $messages.animate({ scrollTop: $messages.prop('scrollHeight') }, 300);
              if (null == currentChatId) {
                  getCurrentChatId();
              }
              $('.stop_wrapper').hide();
          } else if (null == receivingMessage) {
              var message = new Message({
                                    text: text,
                                    message_side: 'right',
                                    currentAnswer: null,
                                    title: null
              });
              $('.message_input').val('');
              message.draw();
              receivingMessage = message.currentAnswer;
              $('.stop_wrapper').show();
              return $messages.animate({ scrollTop: $messages.prop('scrollHeight') }, 300);
          } else {
              markdown_content.append(text);
              let html = md.render(markdown_content.text());
              receivingMessage.html(html);
              if (-1 != text.indexOf('\n'))
                  $messages.animate({ scrollTop: $messages.prop('scrollHeight') }, 300);
          }
        };

        function timeSince(date) {
            let now = new Date().getTime();
            let seconds = (now / 1000) - date;
            let interval = seconds / 31536000;
            if (interval > 1) {
                return Math.floor(interval) + 'y';
            }
            interval = seconds / 2592000;
            if (interval > 1) {
                return Math.floor(interval) + 'M';
            }
            interval = seconds / 86400;
            if (interval > 1) {
                return Math.floor(interval) + 'd';
            }
            interval = seconds / 3600;
            if (interval > 1) {
                return Math.floor(interval) + 'h';
            }
            interval = seconds / 60;
            if (interval > 1) {
                return Math.floor(interval) + 'm';
            }
            return Math.floor(seconds) + 's';
        }

        /* this to load history and some pre-defined training JSON docs */
        async function loadChats (type = 'user') {
            if (!loggedIn) {
                return;
            }
            addSidebarItem ('system-new', 'New Chat', '');
            $('.loader').show();
            try {
                let url = new URL('/chat/api/listChats', httpServer);
                let params = new URLSearchParams(url.search);
                params.append('chat_type', type);
                params.append('n', 512); // 512 is an arbitrarly limit, perhaps in config
                url.search = params.toString();
                const resp = await authClient.fetch (url.toString());
                if (resp.status === 200) {
                    chatTopicsCache = await resp.json();
                    chatTopicsCache.slice(0,20).forEach (function (item) { // same as 20 see ^^^
                        const chat_id = item['chat_id'];
                        let title = (item['title'] != null ? item['title'] : item['chat_id']);
                        let more = '';
                        const ts = item['ts'];
                        if (null == currentChatId && -1 == chat_id.indexOf('system-'))
                          currentChatId = lastChatId = chat_id;
                        if (null != ts)
                          more = ' <span class="timestamp">(' + timeSince(ts) + ')</span>';
                        addSidebarItem (chat_id, title, more);
                    });
                } else {
                    showNotice ('Loading chats failed: ' + resp.statusText);
                }
            } catch (e) {
                showNotice('Loading chats failed: ' + e);
            }
            $('.loader').hide();
            return;
        }

        /* load messages so far and sets the currentChatId */
        async function loadConversation (chat_id) {
            var $messages = $('.messages');
            let url = new URL('/chat/api/chatTopic', httpServer);
            let params = new URLSearchParams(url.search);
            params.append('session_id', session.info.sessionId);
            params.append('chat_id', chat_id);
            $messages.empty();
            $('.loader').show();
            try {
                url.search = params.toString();
                const resp = await authClient.fetch (url.toString());
                if (resp.status === 200) {
                    var lastModelUsed;
                    let list = await resp.json();
                    var lastMessage = null;
                    list.forEach (function (item) {
                        let role = item.role;
                        let text = item.text;
                        let func = item.func;
                        let func_args = item.func_args;
                        if ('user' === role) {
                            sendMessage (text, 'left', false);
                            lastMessage = null;
                            lastModelUsed = item.model;
                            temperature = item.temperature;
                            top_p = item.top_p;
                        } 
                        if ('assistant' === role && null != text) {
                            if (null == lastMessage) {
                                markdown_content.html('');
                                markdown_content.append (text);
                                lastMessage = sendMessage (text, 'right', false);
                            } else {
                                markdown_content.append(text);
                                let html = md.render(markdown_content.text());
                                lastMessage.html(html);
                            }
                        }
                        if ('assistant' === role && null != func) {
                            let title = 'Function: <b>' + item.func_title + '</b> ('+ func + ')';
                            let text = '\n**Arguments:**\n```json\n' + func_args + '\n```';
                            sendMessage (text, 'middle', false, title);
                            lastMessage = null;
                            markdown_content.html('');
                        } else if ('function' === role) {
                            let $li = $('.messages .middle').last();
                            let $res = $li.find('.result');
                            if (text.length > 1) {
                                $res.html (md.render ('**Result:**\n```\n'+text+'\n```'));
                            } else {
                                $res.html ('<b>N/A</b>');
                            }
                        }

                    });
                    markdown_content.html('');
                    receivingMessage = null;
                    // console.log ('loadConversation model:'+lastModelUsed+' chat_id:'+chat_id);
                    currentChatId = chat_id;
                    setModel (lastModelUsed);
                    updateShareLink();
                    initFunctionList();
                    $messages.animate({ scrollTop: $messages.prop('scrollHeight') }, 300);
                } else
                    showNotice ('Conversation failed to load failed: ' + resp.statusText);
            } catch (e) {
                showNotice('Loading conversation failed: ' + e);
            }
            $('.loader').hide();
            return;
        }
        onOpen = function(event) {
            chatAuthenticate (); /* used also to set currentChatId */
            if (!helloSent) { /* send init message e.g. Init or something else to cause Chat bot to answer */
                if (null != currentChatId) {
                    loadConversation(currentChatId);
                }
                helloSent = true;
            }
        };
        onMessage = function(event) { /* self explanatory */
            $('.loader').hide();
            readMessage (event.data);
        };
        onError = function(event) {
            sendMessage ('Error connecting to the server.', 'right');
            $('.loader').hide();
            $('.message_input').prop('disabled', true);
            webSocket.close();
        };
        onClose = function (event) {
            sendMessage ('Connection to the server closed.', 'right');
            $('.send_message').hide();
            $('.loader').hide();
            $('.reconnect').show();
            $('.message_input').prop('disabled', true);
        };
        /* next two are to send questions to server endpoint */
        $('.send_message').click(function (e) {
            var text = getMessageText();
            if (loggedIn) {
                let request = { type: 'user', question: text, chat_id: currentChatId,
                    model: currentModel, call: enabledCallbacks, apiKey: apiKey, temperature: temperature, top_p: top_p };
                sendMessage(text, 'left');
                if (typeof (webSocket) === 'undefined' || text.trim() === '')
                  return;
                $('.loader').show();
                cancelContinueAction ();
                return webSocket.send(JSON.stringify(request));
            }
            else {
               showNotice ('Not logged in');
               return;
            }
        });
        $('.message_input').keypress(function (e) {
            if (e.shiftKey && e.keyCode === 13) {
                let content = this.value;
                let caret = this.selectionStart;
                let newText = content.substring(0, caret) + '\n' + content.substring(caret);
                this.value = newText;
                this.selectionStart = caret + 1;
                this.selectionEnd = caret + 1;
                this.focus();
                e.preventDefault();
            }
            else if (e.which === 13) {
                var text = getMessageText();
                e.preventDefault();
                if (text.trim() === '') {
                    $('.message_input').val('');
                    return;
                }
                if (loggedIn) {
                    let request = { type: 'user', question: text, chat_id: currentChatId,
                        model: currentModel, call: enabledCallbacks, apiKey: apiKey,
                        temperature: temperature, top_p: top_p };
                    sendMessage(text, 'left');
                    $('.loader').show();
                    cancelContinueAction ();
                    return webSocket.send(JSON.stringify(request));
                }
                else {
                    showNotice ('Not logged in');
                    return;
                }
            }
        });
        $('.reconnect').click(function (e) { /* self explanatory */
            webSocket = new WebSocket(url.toString());
            sendMessage('Connected', 'right');
            webSocket.onopen = onOpen;
            webSocket.onmessage = onMessage;
            webSocket.onerror = onError;
            webSocket.onclose = onClose;
            $('.reconnect').hide();
            $('.message_input').prop('disabled', false);
            $('.send_message').show();
        });
        $('.continue').click(function (e) {
            let lastBreak = markdown_content.text().lastIndexOf ('\n');
            let lastLine = lastBreak != -1 ? '\n' + markdown_content.text().substring(lastBreak) : '';
            let request = { type: 'system', question: 'continue'+lastLine, chat_id: currentChatId,
                model: currentModel, call: enabledCallbacks, apiKey: apiKey,
                temperature: temperature, top_p: top_p };
            //console.log(`lastLine: "[${lastLine}]"`);
            webSocket.send(JSON.stringify(request));
            $('.loader').show();
            $('.continue_wrapper').hide();
        });
        $('.stop').click(function (e) {
            let url = new URL('/chat/api/chatControl', httpServer);
            let params = new URLSearchParams(url.search);
            params.append('session_id', session.info.sessionId);
            url.search = params.toString();
            try {
                const resp = authClient.fetch (url.toString());
                $('.stop_wrapper').hide();
            } catch (e) {
                showNotice('Stop failed: ' + e);
            }
        });
        /* these are for Solid Login gizmo & co */
        async function authLogin() {
            let url = new URL(window.location.href);
            url.search = '';
            url.hash = '';
            authClient.login({
                 oidcIssuer: httpServer,
                 redirectUrl: url.toString(),
                 tokenType: 'DPoP',
                 clientName: 'OpenLink Personal Assistant'
            });
        }

        $('.continue_session').click(function (e) {
            let url = new URL(window.location.href);
            let params = new URLSearchParams(url.search);
            let chat_id = params.get('chat_id');
            params.delete('chat_id');
            params.append ('resume_chat_id', chat_id);
            url.search = params.toString();
            authClient.login({
                 oidcIssuer: httpServer,
                 redirectUrl: url.toString(),
                 tokenType: 'DPoP',
                 clientName: 'OpenLink Personal Assistant'
            });
        });

        async function updateLoginState() {
            $('#loginID').toggleClass('d-none', loggedIn);
            $('#logoutID').toggleClass('d-none', !loggedIn);

            if (loggedIn) {
                let params = new URLSearchParams(url.search);
                let resume = pageParams.get('resume_chat_id');
                params.append('sessionId',session.info.sessionId);
                url.search = params.toString();

                $('.loggedin-btn').show();
                $('.loggedin-btn').attr('href', session.info.webId);
                $('.loggedin-btn').attr('title', session.info.webId);
                $('.loggedin-btn').tooltip({container: 'body'});

                $('#api-key-modal-btn').show();

                if (null != resume) {
                    await resumeAsNew(resume);
                    await loadConversation (currentChatId);
                }
                /* init the left drop down side bar and sets the currentChatId */
                await initSidebar();
                /* this connect only, the authentication is onOpen hook/chatAuthenticate */
                webSocket = new WebSocket(url.toString());
                $('.reconnect').hide();
                webSocket.onopen = onOpen;
                webSocket.onmessage = onMessage;
                webSocket.onerror = onError;
                webSocket.onclose = onClose;
            }
        }

        async function authLogout() {
            let url = new URL(window.location.href);
            url.search = '';
            await authClient.logout();
            location.replace(url.toString());
        }
        /* baloon for warnings an errors */
        async function showNotice (text) {
            const tm = 3000;
            $('#msg').html(text);
            $('#snackbar').show();
            setTimeout(function () {  $('#snackbar').hide(); }, tm);
        }

        /* adding an item on side bar */
        function addSidebarItem (id, text, more, before = null) {
            var $list_item = $($('.list-group-item-template').clone().html());
            var $list_item_text = $list_item.children('.list-item-text');

            $list_item.addClass('list-group-item').attr('id',id);
            $list_item.children('.list-item-edit').attr('value',text).hide();

            $list_item_text.append(' '+ text + ' ' +more);
            $list_item_text.on ('click', function () { selectSession ($(this).parent().attr('id')); });
            if (-1 == id.indexOf('system-')) {
                $list_item.addClass ('user-topic');
                $list_item.children('.btn-delete').on ('click', function () { deleteItem ($(this)); });
                $list_item.children('.btn-edit').on ('click', function () { editItem ($(this)); });
                $list_item.children('.btn-confirm').on ('click', function () { confirmItem ($(this),'confirm'); });
                $list_item.children('.btn-cancel').on ('click', function () { confirmItem ($(this),'cancel'); });
            } else {
                $list_item.addClass ('system-topic');
                $list_item.children('.btn-delete').remove();
                $list_item.children('.btn-edit').remove();
                $list_item_text.css('background-image', 'url("svg/chat-right.svg")');
            }
            if (null == before) {
                $('.chat-sessions').append($list_item);
            } else {
                $list_item.insertBefore('#'+before);
            }
        }

        async function editItem ($btn) {
            var $item = $btn.parent();
            var id = $item.attr('id');

            $('#item-action').val('edit');
            $item.children('.list-item-text').hide();
            $item.children('.btn-delete').hide();
            $item.children('.btn-edit').hide();

            $item.children('.btn-confirm').show();
            $item.children('.btn-cancel').show();
            $item.children('.list-item-edit').show().focus().select();
            $item.children('.list-item-edit').keypress(function (e) {
                if (e.which === 13) {
                    confirmItem($(this), 'confirm');
                }
            });
        }

        async function deleteItem ($btn) {
            var $item = $btn.parent();
            var id = $item.attr('id');

            $('#item-action').val('delete');

            $item.children('.btn-confirm').show();
            $item.children('.btn-cancel').show();

            $item.children('.btn-delete').hide();
            $item.children('.btn-edit').hide();
        }

        async function resumeAsNew(chat_id) {
            let url = new URL('/chat/api/createTopic', httpServer);
            let params = new URLSearchParams(url.search);
            params.append('session_id', session.info.sessionId);
            params.append('chat_id', chat_id);
            url.search = params.toString();
            try {
                const resp = await authClient.fetch (url.toString());
                if (resp.status === 200) {
                    let chat = await resp.json();
                    let title = chat['title'];
                    currentChatId = chat['chat_id'];
                    helloSent = true;
                } else
                    showNotice ('Resuming chat failed: ' + resp.statusText);
            } catch (e) {
                showNotice('Resuming chat failed: ' + e);
            }
        }

        async function confirmItem ($btn, approve) {
            var $item = $btn.parent();
            var id = $item.attr('id');
            var action = $('#item-action').val();

            /*console.log('confirm id:'+id+' approve:'+approve+' val:'+$item.children('.list-item-edit').val() +  ' action:' + action );*/
            if (approve === 'confirm') {
                let url = new URL('/chat/api/chatTopic', httpServer);
                let params = new URLSearchParams(url.search);
                params.append('session_id', session.info.sessionId);
                params.append('chat_id', id);
                url.search = params.toString();
                if (action === 'delete') {
                    try {
                        resp = await authClient.fetch(url.toString(), { method:'DELETE' })
                        if (resp.status != 204) {
                            showNotice('Delete failed: ' + resp.statusText);
                        } else {
                            $('#'+id).hide(); /* contrary to logic we just hide to keep DOM consistent */
                            chatTopicsCache = chatTopicsCache.filter((item) => item.chat_id != id);
                            if (currentChatId === id) {
                                $('.messages').empty();
                                currentChatId = null;
                            }
                        }
                    } catch (e) {
                        showNotice('Delete failed: ' + e);
                    }
                }
                else if (action === 'edit') {
                    var text = $item.children('.list-item-edit').val();
                    $item.children('.list-item-text').text(text);
                    chatTopicsCache = chatTopicsCache.filter(function(item) {
                        if (item.chat_id === id) {
                            item.title = text;
                        }
                        return true;
                    });
                    try {
                        resp = await authClient.fetch(url.toString(), { method:'POST', body: JSON.stringify ({title: text, model: currentModel}) })
                        if (!resp.ok || resp.status != 200) {
                            showNotice('Edit failed: ' + resp.statusText);
                        }
                    } catch (e) {
                        showNotice('Edit failed: ' + e);
                    }
                }
            }

            $('#item-action').val('');

            $item.children('.btn-confirm').hide();
            $item.children('.btn-cancel').hide();
            $item.children('.list-item-edit').hide();

            $item.children('.btn-edit').show();
            $item.children('.btn-delete').show();
            $item.children('.list-item-text').show();
        }

        async function setModel (text) {
            if (null == text)
                return;
            $('#oai-model span.model').text(text.toUpperCase());
            currentModel = text;
        }

        async function selectSession (id) {
            $('#slide-submenu').closest('.chat-sessions').fadeOut('slide',function(){
                $('.mini-submenu').fadeIn();
            });
            $('.messages').empty();
            if (-1 == id.indexOf ('system-'))
                await loadConversation (id);
            if (0 == id.indexOf ('system-') && typeof (webSocket) != 'undefined') {
                let request = { type: 'user', question: null, chat_id: id, model: currentModel, call: null, apiKey: apiKey,
                    temperature: temperature, top_p: top_p };
                currentChatId = null;
                receivingMessage = null;
                $('.message_input').val('');
                webSocket.send(JSON.stringify(request));
                $('.loader').show();
            }
        }

        async function initFineTune() {
            let $list = $('.fine-tune');
            try {
                let url = new URL('/chat/api/listFineTune', httpServer);
                const resp = await fetch (url.toString());
                if (resp.status === 200) {
                    $list.empty();
                    let chats = await resp.json();
                    chats.forEach (function (item) {
                        let title = null != item.title ? item.title : item.chat_id;
                        let more = null != item.ts ? ' <span class="timestamp">(' + timeSince(item.ts) + ')</span>' : '';;
                        let $list_item = $($('.list-group-item-template').clone().html());
                        var $list_item_text = $list_item.children('.list-item-text');
                        $list_item.addClass('list-group-item').attr('id',item.chat_id);
                        $list_item_text.append(' '+ item.title + ' ' +more);
                        $list_item.children('.btn-delete').remove();
                        $list_item.children('.list-item-edit').remove();
                        $list_item.children('.btn-edit').remove();
                        $list_item_text.css('background-image', 'url("svg/chat-right.svg")');
                        $list_item_text.on ('click', function () { selectFineTune ($(this).parent().attr('id')); });
                        $list.append($list_item);
                    });
                } else {
                    showNotice('Loading pre-defined prompts failed: ' + resp.statusText);
                }
            } catch (e) {
                showNotice('Loading pre-defined prompts failed: ' + e);
            }
           $list.show(); 
        }

        async function selectFineTune (id) {
            $('.bd-modal-tune-sel').modal('hide');
            if (0 == id.indexOf ('system-') && typeof (webSocket) != 'undefined') {
                let request = { type: 'user', question: null, chat_id: id, model: currentModel, call: null, apiKey: apiKey,
                    temperature: temperature, top_p: top_p };
                $('.messages').empty();
                currentChatId = null;
                receivingMessage = null;
                $('.message_input').val('');
                webSocket.send(JSON.stringify(request));
                $('.loader').show();
            } else {
               showNotice ('Not logged in');
            }
        }


        async function initFunctionList() {
            var funcList = $('#available-functions');
            try {
                let url = new URL('/chat/api/listFunctions', httpServer);
                let params = new URLSearchParams(url.search);
                params.append('chat_id', currentChatId != null ? currentChatId : plink);
                url.search = params.toString();
                const resp = await fetch (url.toString());
                if (resp.status === 200) {
                    let funcs = await resp.json();
                    funcList.empty();
                    enabledCallbacks = new Array();
                    funcs.forEach (function (item) {
                       const fn = item['function'];
                       const title = item['title'];
                       const sel = item['selected'];
                       if (sel) {
                           enabledCallbacks.push (fn);
                       }
                       let li = $('<li><input type="checkbox"/><label></label></li>');
                       let cbox = li.children('input');
                       cbox.attr('id', fn);
                       cbox.checked = sel;
                       cbox.click(function(e) {
                           let pos = enabledCallbacks.indexOf(this.id);
                           if (this.checked && -1 == pos) {
                               enabledCallbacks.push (this.id);
                           }
                           if (!this.checked && -1 != pos) {
                               enabledCallbacks.splice(pos, 1);
                           }
                           if (enabledCallbacks.length) {
                               $('#fn-count').html(`[${enabledCallbacks.length}]`).show();
                           } else
                               $('#fn-count').hide();
                       });
                       li.children('label').attr('for', fn);
                       li.children('label').html(title);
                       funcList.append (li);
                    });
                } else
                    showNotice ('Loading helper functions failed: ' + resp.statusText);
            } catch (e) {
                showNotice('Loading helper functions failed: ' + e);
            }
            if (enabledCallbacks.length) {
                $('#fn-count').html(`[${enabledCallbacks.length}]`).show();
            } else
                $('#fn-count').hide();
            $('.bd-modal-fn-sel').on('hide.bs.modal', function (e) {
                 $('#available-functions > li input').each (function () {
                     if (-1 == enabledCallbacks.indexOf(this.id))
                         this.checked = false;
                 });
            });
            $('.bd-modal-fn-sel').on('show.bs.modal', function (e) {
                 $('#available-functions > li input').each (function () {
                     if (-1 != enabledCallbacks.indexOf(this.id))
                       this.checked = true;
                 });
            });
            $('#temperature').val(temperature);
            $('#temperature_in').val(temperature);
            $('#top_p').val(top_p);
            $('#top_p_in').val(top_p);
        }

        async function initSidebar () {
            $('#slide-submenu').on('click',function() {
                $(this).closest('.chat-sessions').fadeOut('slide',function(){
                    $('.mini-submenu').fadeIn();
                });
            });

            $('.mini-submenu').on('click',function(){
                $(this).next('.chat-sessions').toggle('slide');
                $('.mini-submenu').hide();
            })

            /* user chats */
            await loadChats ();
            /* init plink copy */
            $('.share-btn').click(function (e) {
                e.preventDefault();
                var $temp = $('<input>');
                $('body').append($temp);
                $temp.val($(this).attr('href')).select();
                document.execCommand('copy');
                $temp.remove();
                showNotice('Permalink to the chat copied.');
            });

            async function chatListReload() {
                $('.chat-sessions').find('.user-topic').remove();
                $('.chat-sessions').find('.system-topic').remove();
                $('.filter-input').val('');
                lastSearch = '';
                $('.btn-fliter-clear').hide();
                loadChats();
            }

            $('#topics-refresh').on('click', chatListReload);
            $('.btn-fliter-clear').on('click', chatTopicsCacheReload);

            async function chatListFilter (word) {
                if (ftSearch) {
                    freeTextTopicSearch (word);
                    return;
                }
                const result = chatTopicsCache.filter((item) => item.title.toUpperCase().indexOf(word.toUpperCase()) != -1);
                $('.btn-fliter-clear').show();
                $('.chat-sessions').find('.user-topic').remove();
                result.forEach (function (item) {
                    addSidebarItem (item.chat_id, 
                                    item.title, 
                                    item.ts != null ? ' <span class="timestamp">(' + timeSince(item.ts) + ')</span>' : '');
                    lastSearch = word;
                });
            }

            async function chatTopicsCacheReload() {
                $('.chat-sessions').find('.user-topic').remove();
                $('.filter-input').val('');
                $('.btn-fliter-clear').hide();
                lastSearch = '';
                /*console.log('Reloading from cache... {}',chatTopicsCache.length);*/
                chatTopicsCache.slice(0,20).forEach (function (item) {
                    addSidebarItem (item.chat_id, 
                                    item.title, 
                                    item.ts != null ? ' <span class="timestamp">(' + timeSince(item.ts) + ')</span>' : '');
                });
            }


            let timeoutID = null;

            $('.filter-input').keyup(function(e) {
                clearTimeout(timeoutID);
                const value = e.target.value
                if (0 === value.length && lastSearch.length) {
                    chatTopicsCacheReload();
                } else {
                    timeoutID = setTimeout(() => chatListFilter(value), 500)
                }
            });

            $('.btn-filter').on('click',function() {
                let query = $('.filter-input').val();
                if (!ftSearch) {
                    lastSearch = '';
                }
                ftSearch = !ftSearch;
                $('.btn-filter-img').css('background-color', ftSearch ? 'lightblue' : 'white');
                if (query.length > 2) {
                    chatListFilter(query);
                }
            });
        }

        async function freeTextTopicSearch(query) {
            if (query.length < 2 || lastSearch === query) {
                return;
            }
            lastSearch = query;
            $('.btn-fliter-clear').show();
            $('.loader').show();
            try {
                let url = new URL('/chat/api/searchChats', httpServer);
                let params = new URLSearchParams(url.search);
                params.append('query', query);
                url.search = params.toString();
                const resp = await authClient.fetch (url.toString());
                if (resp.status === 200) {
                    let chats = await resp.json();
                    $('.chat-sessions').find('.user-topic').remove();
                    $('.chat-sessions').find('.system-topic').remove();
                    chats.forEach (function (item) {
                        let title = null != item.title ? item.title : item.chat_id;
                        let more = null != item.ts ? ' <span class="timestamp">(' + timeSince(item.ts) + ')</span>' : '';;
                        addSidebarItem (item.chat_id, title, more);
                    });
                    if (0 == chats.length) {
                        showNotice ('Filter `'+query+'` do not match any topic');
                    }
                } else
                    showNotice ('Filtering chats failed: ' + resp.statusText);
            } catch (e) {
                showNotice('Filtering chats failed: ' + e);
            }
            $('.loader').hide();
            return;
        }

        var models = ['gpt-3.5-turbo-0301', 'gpt-3.5-turbo-0613', 'gpt-3.5-turbo-16k-0613', 'gpt-3.5-turbo-16k', 'gpt-3.5-turbo',
            'gpt-4-0314', 'gpt-4-0613', 'gpt-4' ];

        models.reverse().forEach (function(item) {
            var li = $('<li><a href="#" class="dropdown-item gpt-model"></a></li>');
            li.children('a').text(item.toUpperCase());
            $('#oai-model-id').append(li);
        });


        $('.dropdown-menu a.gpt-model').click(function(e){ setModel(this.text); e.preventDefault(); });

        try {
            authClient.handleIncomingRedirect();
        } catch (e) {
            showNotice ('Login failed: '+e);
        }
        if (chatDebug) {
            initSidebar();
        }
        setModel(currentModel);
        initFineTune();
        if (null === currentChatId) {
            initFunctionList();
        }
        /*
        $(document).on("click", function(event) {
            const $menu = $('.chat-sessions');
            if ($menu.is(':visible') && !$menu.is(event.target)) {
                $menu.hide();
                $('.mini-submenu').fadeIn();
            }
        });
        */
        $('#loginID').toggleClass('d-none', loggedIn);
        $('#logoutID').toggleClass('d-none', !loggedIn);
        if (null != plink) {
            loadConversation(plink);
            $('.send_message').hide();
        } else {
            $('.continue_session').hide();
        }
        $('[data-toggle="tooltip"]').tooltip({container: 'body'});

        $('.reconnect').hide();
        $('.continue_wrapper').hide();
        $('.stop_wrapper').hide();
        $('#btn-api-key-save').click (function () {
            apiKey = $('#api-key').val();
            if (apiKey.length || !apiKeyRequired) {
                $('.key-icon').attr('src', 'svg/unlock.svg');
            } else {
                $('.key-icon').attr('src', 'svg/key.svg');
            }
            $('#api-key-modal').modal('hide');
        });
        $('#api-key').keypress(function (e) {
            if (e.which === 13 && this.value.length > 1) {
                apiKey = this.value;
                $('.key-icon').attr('src', 'svg/unlock.svg');
                $('#api-key-modal').modal('hide');
            }
        });
        $('#api-key-modal').on('shown.bs.modal', function () {
            $('#api-key').focus();
        })
        $('#btn-api-key-remove').click (function () {
            $('#api-key').val('');
            apiKey = null;
            if (apiKeyRequired)
                $('.key-icon').attr('src', 'svg/key.svg');
            $('#api-key-modal').modal('hide');
        });
        $('#temperature_in').on("input", function(e) {
            temperature = parseFloat (e.target.value);
            $('#temperature').val(e.target.value);
        });
        $('#temperature').on("input", function(e) {
            temperature = parseFloat (e.target.value);
            console.log(temperature);
            $('#temperature_in').val(e.target.value);
        });
        $('#top_p_in').on("input", function(e) {
            top_p = parseFloat (e.target.value);
            $('#top_p').val(e.target.value);
        });
        $('#top_p').on("input", function(e) {
            top_p = parseFloat (e.target.value);
            $('#top_p_in').val(e.target.value);
        });
        $('#fn-debug').on('click', function(e) {
            let $messages = $('.messages');
            $('.message.middle').toggleClass('d-none', !e.target.checked);
            if (e.target.checked) {
                $messages.animate({ scrollTop: $messages.prop('scrollHeight') }, 0);
            }
        });
    });
}.call(this));

