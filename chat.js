/*
 *  This file is part of the OpenLink Software OpenLink Software Personal Assistant project.
 *
 *  Copyright (C) 2024 OpenLink Software
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
       let select = '<SELECT class="code_type" > '+
                    '  <OPTION id="none" selected></OPTION> '+
                    '  <OPTION id="turtle">RDF-Turtle</OPTION> '+
                    '  <OPTION id="jsonld">JSON-LD</OPTION> '+
                    '  <OPTION id="json">JSON</OPTION> '+
                    '  <OPTION id="csv">CSV</OPTION> '+
                    '  <OPTION id="rdfxml">RDF/XML</OPTION> '+
                    '  <OPTION id="markdown">Markdown</OPTION> '+
                    '  <OPTION id="rss">RSS</OPTION> '+
                    '  <OPTION id="atom">Atom</OPTION> '+
                    '</SELECT> <span>Data format:</span>';
      let copy_btn = '<button class="btn clipboard"><img src="svg/clipboard.svg"/></button>';

       if (lang && hljs.getLanguage(lang)) {
           try {
               return '<div class="code_header">'+select + '</div>' + copy_btn +
                   '<div class="code_block"><pre class="hljs"><code><div class="nano_start"></div>' +
                     hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
                   '<div class="nano_end"></div></code></pre></div>';
           } catch (__) {}
       }
           return '<div class="code_header">'+select+'</div>'+ copy_btn +
                  '<div class="code_block"><pre class="hljs"><code><div class="nano_start"></div>' +
                   md.utils.escapeHtml(str) +
                  '<div class="nano_end"></div></code></pre></div>';
       }
});

var clipboard = new ClipboardJS('.clipboard', {
    target: function(trigger) {
        return trigger.nextElementSibling;
    }
});


(function () {
    var Message;
    $(function () { /* document ready */
        var pageUrl = new URL(window.location);
        var targetHost = typeof(httpServer) != 'undefined' ? new URL(httpServer).host : pageUrl.host;
        var getMessageText, sendMessage, onOpen, onMessage, onError, onClose, webSocket, readMessage;
        var httpBase = 'https://' + targetHost;
        var wsApiUrl = typeof(wsServer) != 'undefined' ? wsServer : 'wss://' + targetHost + '/ws/chat';
        var vadVersion = typeof(vad_version) != 'undefined' ? vad_version : '';
        // console.log (`httpBase:${httpBase} wsApiUrl:${wsApiUrl}`);
        var authType = typeof(authenticationType) != 'undefined' ? authenticationType : 'DPoP';
        var authClient = solidClientAuthentication.default;
        var wsUrl = new URL(wsApiUrl); /* WebSockets endpoint */
        var helloSent = false; /* flag to send "hello* message */
        var lastChatId = null /* last user chat to add new items before */, currentChatId = null;
        var currentModel = 'gpt-4';
        var openerObj = undefined;
        var temperature = 0.2;
        var top_p = 0.5;
        var max_tokens = 300;
        var max_items = 500;
        var receivingMessage = null; /* this is not null when receiving response, keeps object which present current answer */
        var enabledCallbacks = [];
        var markdown_content = '';
        var loggedIn = false;
        var apiKeyRequired = true;
        var apiKey = null;
        var lastSearch = '';
        var ftSearch = false;
        var chatTopicsCache = [];
        var session = authClient.getDefaultSession();
        /* next are for login gizmo */
        var pageParams = new URLSearchParams(pageUrl.search);
        var sharedSession = pageParams.get('chat_id');
        var sharedItem = pageUrl.hash;
        let mediaRecorder = undefined;
        let recodingTimeout = null;
        var importedSession = undefined;
        var storageFolder = null;
        var sessionRestored = false;
        var logoutOnError = false;
        var chatSessionTimeoutMsec = typeof (chatSessionTimeout) != 'undefined' ? chatSessionTimeout * 1000 : -1;

        if (vadVersion.length) {
            $('#vad_version').text('('+vadVersion+')');
        }

        Message = function (arg) {
            this.text = arg.text, this.message_side = arg.message_side, this.title = arg.title,
                this.prompt_id = arg.prompt_id, this.verified = arg.verified;
            this.draw = function (_this) {
                return function () {
                    var $message;
                    if (_this.message_side === 'middle') {
                        var $button, $text, $args;
                        let text_id = Math.random().toString(36).replace('0.','fnm-');
                        $message = $($('.fn_template').clone().html());
                        $message.addClass(_this.message_side);
                        if (!$('#fn-debug').is(':checked')) {
                            $message.addClass('d-none');
                        }
                        $button = $message.find('.accordion-button');
                        $text = $message.find('.text');
                        $args = $text.find('.args');
                        $text.attr('id', text_id);
                        $button.attr('data-bs-target', '#'+text_id);
                        $button.children('.fnb_text').html(_this.title);
                        $args.html(md.render(_this.text));
                    } else if (_this.message_side === 'left') {
                        $message = $($('.message_template').clone().html());
                        $message.addClass(_this.message_side).find('.text').append($('<pre></pre>').text(_this.text));
                    } else {
                        $message = $($('.message_template').clone().html());
                        markdown_content = _this.text;
                        $message.addClass(_this.message_side).find('.text').html(md.render(_this.text));
                    }
                    _this.currentAnswer = $message.find('.text');
                    if (null != this.prompt_id) {
                        $message.attr('id', this.prompt_id);
                    }

                    $message.find('.share-prompt-btn').click (function(e) {
                        e.preventDefault();
                        let prompt_id = $(this).closest('.message').attr('id');
                        copyLinkToClipboard(prompt_id);
                    }).toggleClass('d-none',!loggedIn);

                    if ('left' != _this.message_side && $('.messages').children().length > 0) {
                        let $like = $message.find('.like');
                        if (loggedIn) {
                            $like.click (function(e) {
                                e.preventDefault();
                                let prompt_id = $(this).closest('.message').attr('id');
                                setPromptFlag(prompt_id);
                            });
                        }
                        $like.toggleClass('d-none',!_this.prompt_id);
                        if (_this.verified) {
                            $like.find('img').attr('src', 'svg/star-fill.svg');
                        }
                        $like.tooltip({container: 'body'});
                    } else {
                        $message.find('.like').toggleClass('d-none',true);
                    }

                    $message.attr('data-verified', _this.verified);
                    $('.messages').append($message);
                    return setTimeout(function () {
                        return $message.addClass('appeared');
                    }, 0);
                };
            }(this);
            return this;
        };

        $(".messages").change((ev)=> {
            if (ev.target && ev.target.matches('select.code_type')) {
              const parent = ev.target.closest('code');
              if (parent) {
                  const start = parent.querySelector('div.nano_start');
                  const end = parent.querySelector('div.nano_end');
                  const sel = ev.target.querySelector('option:checked').id;
                  let name = null;
                  switch(sel) {
                    case 'turtle': name='Turtle'; break;
                    case 'jsonld': name='JSON-LD'; break;
                    case 'json':   name='JSON'; break;
                    case 'csv':    name='CSV'; break;
                    case 'rdfxml': name='RDF/XML'; break;
                    case 'markdown': name='Markdown'; break;
                    case 'rss':    name='RSS'; break;
                    case 'atom':   name='Atom'; break;
                  }
                  if (name) {
                      start.textContent = '## '+name+' Start ##';
                      end.textContent = '## '+name+' Stop ##';
                  } else {
                      start.textContent = '';
                      end.textContent = '';
                  }
              }
            }
        })

        async function isDavSupported (url) {
            if (!url) return false;
            rc = await authClient.fetch(url, { method: 'OPTIONS'}).
                then ((resp) => {
                    if (resp.status != 204) {
                        return false;
                    }
                    let dav = resp.headers.get('DAV');
                    if (dav?.split(',').includes('1')) {
                        return true;
                    }
                    return false;
                })
                .catch((e) => {
                    showNotice ('Can not get storage options: ' + e);
                    return false;
                });
            return rc;
        }

        session.onSessionRestore(function() {
            sessionRestored = true;
            /*console.log('Session restored');*/
        });
        /*
        session.onSessionExpiration(function(url) {
            console.log('Session expired: ',url);
        });
        session.onLogin(function() {
            console.log ('onLogin');
        });
        session.onLogout(function() {
            console.log('onLogout: ' + session.info.isLoggedIn);
        });*/

        $('#loginID').click(authLogin);
        $('#logoutID').click(authLogout);

        getMessageText = function () {
            var $message_input;
            $message_input = $('.message_input');
            return $message_input.val();
        };

        function getPromptId() {
            return Math.random().toString(36).replace('0.','usr-');
        }

        /* used to write R/L on chat window only */
        sendMessage = function (prompt_id = null, text, message_side, scroll = true, title = null, verified = 0) {
            var $messages, message;
            if (text.trim() === '') {
                return;
            }
            $messages = $('.messages');
            if (message_side === 'left' && prompt_id === null) {
                prompt_id = getPromptId();
            }
            message = new Message({
                text: text,
                message_side: message_side,
                currentAnswer: null,
                title: title,
                prompt_id: prompt_id,
                verified: verified
            });
            message.draw();
            if (null != message.currentAnswer)
                message.currentAnswer.find('a').attr('target','_blank');
            if (scroll)
              $messages.animate({ scrollTop: $messages.prop('scrollHeight') }, 300);
            return message.currentAnswer;
        };

        async function stopRecording() {
            if (mediaRecorder === undefined) return;
            mediaRecorder.stop();
        }

        async function startRecording() {
            if (mediaRecorder === undefined) return;
            mediaRecorder.start(1000);
            recodingTimeout = setTimeout(() => stopRecording(), 5000);
        }

        function audioEnable () {

            if (mediaRecorder != undefined) return;
            if (navigator.mediaDevices.getUserMedia) {

                var mime = 'audio/wav';
                const types = [
                    "audio/mp3",
                    "audio/m4a",
                    "audio/webm",
                    "audio/mp4",
                    "audio/ogg",
                    "audio/flac",
                    "audio/mpeg",
                    "audio/mpga",
                    "audio/wav",
                ];
                for (const type of types) {
                    if (MediaRecorder.isTypeSupported(type)) {
                        mime = type;
                        break;
                    }
                }
                console.log ('MediaRecorder.isTypeSupported:', mime);

                const constraints = { audio: true };
                let chunks = [];


                let onSuccess = function(stream) {
                    const options = {
                        audioBitsPerSecond: 128000,
                        mimeType: mime,
                    };
                    mediaRecorder = new MediaRecorder(stream, options);
                    /* sound detection */
                    const audioContext = new AudioContext();
                    const audioStreamSource = audioContext.createMediaStreamSource(stream);
                    const analyser = audioContext.createAnalyser();
                    analyser.minDecibels = -50;
                    analyser.fftSize = 256;
                    audioStreamSource.connect(analyser);
                    const bufferLength = analyser.frequencyBinCount;
                    const domainData = new Uint8Array(bufferLength);

                    const detectSound = function () {
                        analyser.getByteFrequencyData(domainData);
                        for (let i = 0; i < bufferLength; i++) {
                            if (domainData[i] > 0 && null != recodingTimeout) {
                                clearTimeout(recodingTimeout);
                                recodingTimeout = setTimeout(() => stopRecording(), 5000);
                                break;
                            }
                        }
                        window.requestAnimationFrame(detectSound);
                    }
                    window.requestAnimationFrame(detectSound);
                    /* end sound detection */

                    async function getText (blob) {
                        let url = new URL('/chat/api/voice2text', httpBase);
                        const formData  = new FormData();
                        formData.append('format', mime);
                        if (null != apiKey) {
                            formData.append('apiKey', apiKey);
                        }
                        formData.append('data', blob);
                        $('.loader').show();
                        try {
                            const resp = await authClient.fetch (url.toString(), { method: 'POST', body: formData });
                            if (resp.ok) {
                                let jt = await resp.json();
                                let text = jt.text;
                                if (text.length) {
                                    let prompt_id = getPromptId();
                                    sendMessage(prompt_id, text, 'left');
                                    promptComplete(prompt_id, text);
                                } else {
                                    showNotice ('Recording cannot be transcribed.');
                                }
                            } else {
                                showNotice ('Can not access voice transcription service ' + resp.statusText);
                            }
                        } catch (e) {
                            showNotice ('Can not access voice transcription service ' + e);
                        }
                        $('.loader').hide();
                    }

                    mediaRecorder.onstart = function (e) {
                        $('#start-btn').hide();
                        $('#stop-btn').show();
                    }

                    mediaRecorder.onstop = function(e) {
                        clearTimeout(recodingTimeout);
                        recodingTimeout = null;
                        $('#start-btn').show();
                        $('#stop-btn').hide();
                        const blob = new Blob(chunks, { 'type' : mime });
                        chunks = [];
                        if (apiKey != null || !apiKeyRequired) {
                            getText (blob);
                        } else {
                            showNotice ('Must login and enter API Key in order to get voice transcription');
                        }
                    }
                    mediaRecorder.ondataavailable = function(e) {
                        chunks.push(e.data);
                    }
                    $('#start-btn').show();
                }

                let onError = function(err) {
                    showNotice ('Error occured: ' + err);
                }

                navigator.mediaDevices.getUserMedia(constraints).then(onSuccess, onError);
            } else {
                console.log('getUserMedia not supported on your browser!');
            }
        }

        function audioDisable() {
            if (mediaRecorder != undefined) {
                if (mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                }
                mediaRecorder.stream.getTracks().forEach(track => track.stop());
                mediaRecorder = undefined;
                $('#start-btn').hide();
                $('#stop-btn').hide();
            }
        }

        function cancelContinueAction () {
            $('.messages').find('.cursor').remove();
            receivingMessage = null;
            markdown_content = '';
            $('.continue_wrapper').hide();
        }

        /* associate WS connection with OAuah session and set the chat id if any server side */
        async function chatAuthenticate () {
            try {
                let url = new URL('/chat/api/chatAuthenticate', httpBase);
                let params = new URLSearchParams(url.search);
                params.append('session_id', session.info.sessionId);
                if (null != currentChatId)
                    params.append('chat_id', currentChatId);
                url.search = params.toString();
                const resp = await authClient.fetch (url.toString());
                if (resp.ok) {
                    let obj = await resp.json();
                    apiKeyRequired = obj.apiKeyRequired;
                    if (apiKeyRequired) {
                      apiKey = localStorage.getItem ('openlinksw.com:opal:gpt-api-key');
                      $('#api-key').val(apiKey);
                      apiKeyRequired = !apiKey || apiKey.length < 1;
                    }
                    if (!apiKeyRequired) {
                      $('.key-icon').attr('src', 'svg/unlock.svg');
                      $('#api-key-modal-btn span').attr('title', 'API Key is already set.');
                    } else {
                        $('#api-key-modal').modal('show');
                    }
                    $('#api-key-modal-btn span').tooltip({container: 'body'});
                } else {
                    throw new Error ('Can not authenticate chat session' + resp.statusText);
                }
            } catch (e) {
                logoutOnError = true;
                $('#error-modal').modal('show');
            }
        }

        async function getCurrentChatId () {
            /* here we should current chat if new */
            try {
                let url = new URL('/chat/api/getTopic', httpBase);
                let params = new URLSearchParams(url.search);
                params.append('session_id', session.info.sessionId);
                url.search = params.toString();
                const resp = await authClient.fetch (url.toString());
                if (resp.status === 200) {
                    let chat = await resp.json();
                    const chat_id = chat.chat_id;
                    const title = chat.title;
                    const funcs = chat.funcs;
                    const model = chat.model;
                    temperature = chat.temperature;
                    top_p = chat.top_p;
                    addSidebarItem (chat_id, title, 'now', lastChatId);
                    currentChatId = chat_id;
                    setCurrentChat(chat_id);
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
          let stats = obj.stats;
          let image_data = undefined;
          let prompt_id = obj.prompt_id;
          let $messages = $('.messages');

          if (typeof(text) === 'object') {
              text = null;
              image_data = obj.data.dataUrl;
          }

          if ('function' === kind || 'tool' === kind) {
              let func_call = JSON.parse (text);
              let title = 'Function: <b>' + func_call.func_title + '</b> ('+ func_call.func + ')';
              let div = '\n**Arguments:**\n```json\n' + func_call.func_args + '\n```';
              sendMessage (prompt_id, div, 'middle', false, title);
              $messages.animate({ scrollTop: $messages.prop('scrollHeight') }, 300);
              $('.loader').show();
              $('.stop_wrapper').show();
              $('.messages').find('.cursor').remove();
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
              $('.messages').find('.cursor').remove();
              receivingMessage = null;
          } else if (image_data) {

              var $div = $($('.image-upload-template').clone().html());
              var $img = $div.find('.user-img-src');
              $div.find('.user-img-remove').hide();
              $img.attr("src", image_data);
              hasImages = true;
              $div.find('.user-img-zoom-in').on('click', function (e) {
                  let $img = $(this).siblings('.user-img-src');
                  let height = $img.height();
                  height += 50;
                  if (height >= 480) return;
                  $img.height(height);
              });
              $div.find('.user-img-zoom-out').on('click', function (e) {
                  let $img = $(this).siblings('.user-img-src');
                  let height = $img.height();
                  height -= 50;
                  if (height <= 120) return;
                  $img.height(height);
              });
              $(".messages").append($div);
              receivingMessage = null;

          } else if (text.trim() === '[DONE]' || text.trim() === '[LENGTH]') {
              // make target
              if (null != receivingMessage) {
                  let $message = receivingMessage.closest('.message');
                  $message.attr('id', prompt_id);
                  $message.find('.like').toggleClass('d-none',false);
                  receivingMessage.find('a').attr('target','_blank');
              }
              if (text.trim() === '[LENGTH]') {
                  $('.continue_wrapper').show();
                  $('.messages').find('.cursor').remove();
              } else { /* [DONE] */
                  $('.messages').find('.cursor').remove();
                  receivingMessage = null;
                  markdown_content = '';
                  $('.continue_wrapper').hide();
              }
              $messages.animate({ scrollTop: $messages.prop('scrollHeight') }, 300);
              if (null == currentChatId) {
                  getCurrentChatId();
              }
              if (stats) {
                  setStats(stats.total, stats.elapsed, stats.tokens, stats.delta);
              }
              $('.stop_wrapper').hide();
          } else if (null == receivingMessage) {
              var message = new Message({
                                    text: text,
                                    message_side: 'right',
                                    currentAnswer: null,
                                    title: null,
                                    prompt_id: null
              });
              $('.message_input').val('');
              message.draw();
              receivingMessage = message.currentAnswer;
              if (receivingMessage) {
                  $('<span class="cursor"></span>').insertAfter(receivingMessage);
              }
              $('.stop_wrapper').show();
              return $messages.animate({ scrollTop: $messages.prop('scrollHeight') }, 300);
          } else {
              markdown_content += text;
              let html = md.render(markdown_content);
              receivingMessage.html(html);
              if (-1 != text.indexOf('\n'))
                  $messages.animate({ scrollTop: $messages.prop('scrollHeight') }, 300);
          }
        };

        function TimeHms(msecs) {
            let sec_num = Math.floor(msecs / 1000);
            let hours   = Math.floor(sec_num / 3600);
            let minutes = Math.floor(sec_num / 60) % 60;
            let seconds = sec_num % 60;
            let hms = '';
            if (hours > 0) {
                hms += `${hours}h `;
            }
            if (minutes > 0) {
                hms += `${minutes}m `;
            }
            if (seconds > 0) {
                hms += `${seconds}s `;
            }
            if ('' === hms) {
                hms = `${msecs/1000}s `;
            }
            return hms;
        }

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

        function setCurrentChat(chat_id = currentChatId) {
            $('.chat-sessions .list-group-item').removeClass ('list-item-current');
            if (chat_id != null) $('#'+chat_id).addClass ('list-item-current');
        }

        function setCurrentFineTune(fine_tune = null) {
            $('.fine-tune .list-group-item').removeClass('list-item-current');
            if (null != fine_tune) {
                $('.fine-tune #'+fine_tune).addClass('list-item-current');
            }
        }

        /* this to load history and some pre-defined training JSON docs */
        async function loadChats (type = 'user') {
            if (!loggedIn) {
                return;
            }
            $('.loader').show();
            try {
                let url = new URL('/chat/api/listChats', httpBase);
                let params = new URLSearchParams(url.search);
                params.append('chat_type', type);
                params.append('n', max_items);
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
            setCurrentChat();
            $('.loader').hide();
            return;
        }

        function showConversation(items) {
            if (!(items instanceof Array)) {
                showNotice('Loading conversation failed, the log is empty or corrupted');
                return;
            }
            let lastModelUsed = null;
            let lastMessage = null;
            let hasImages = false;
            let totalTokens = 0;
            let totalTime = 0;
            let lastMessageTokens = undefined;
            let lastDelta = undefined;
            let fine_tune = null;
            $('.messages').empty();
            items.forEach (function (item) {
                let role = item.role;
                let text = item.text;
                let func = item.func;
                let func_args = item.func_args;
                let prompt_id = item.prompt_id;
                let verified = item.verified ? item.verified : 0;
                if (!item.state) {
                    totalTokens += item.tokens ? item.tokens : 0;
                    totalTime += item.delta ? item.delta : 0;
                }
                if (item.tokens && item.tokens > 0) {
                    lastMessageTokens = item.tokens;
                    lastDelta = item.delta;
                }
                fine_tune = item.fine_tune;
                if ('user' === role) {
                    sendMessage (prompt_id, text, 'left', false, null);
                    lastMessage = null;
                    if (item.model && (!hasImages || -1 != item.model.indexOf('vision'))) {
                        lastModelUsed = item.model;
                    }
                    temperature = item.temperature;
                    top_p = item.top_p;
                }
                if ('assistant' === role && null != text) {
                    if (null == lastMessage) {
                        markdown_content = '';
                        markdown_content += text;
                        if (null === lastModelUsed) {
                            lastModelUsed = item.model;
                        }
                        lastMessage = sendMessage (prompt_id, text, 'right', false, null, verified);
                    } else {
                        markdown_content += text;
                        let html = md.render(markdown_content);
                        lastMessage.html(html);
                    }
                }
                if ('assistant' === role && null != func) {
                    let title = 'Function: <b>' + item.func_title + '</b> ('+ func + ')';
                    let text = '\n**Arguments:**\n```json\n' + func_args + '\n```';
                    sendMessage (prompt_id, text, 'middle', false, title, verified);
                    lastMessage = null;
                    markdown_content = '';
                } else if ('function' === role || 'tool' === role) {
                    let $li = $('.messages .middle').last();
                    let $res = $li.find('.result');
                    if (text.length > 1) {
                        $res.html (md.render ('**Result:**\n```\n'+text+'\n```'));
                    } else {
                        $res.html ('<b>N/A</b>');
                    }
                } else if ('image' === role) {
                    var $div = $($('.image-upload-template').clone().html());
                    var $img = $div.find('.user-img-src');
                    $div.find('.user-img-remove').hide();
                    $img.attr("src", item.dataUrl);
                    hasImages = true;
                    $div.find('.user-img-zoom-in').on('click', function (e) {
                        let $img = $(this).siblings('.user-img-src');
                        let height = $img.height();
                        height += 50;
                        if (height >= 480) return;
                        $img.height(height);
                    });

                    $div.find('.user-img-zoom-out').on('click', function (e) {
                        let $img = $(this).siblings('.user-img-src');
                        let height = $img.height();
                        height -= 50;
                        if (height <= 120) return;
                        $img.height(height);
                    });

                    $(".messages").append($div);
                }

            });
            setStats(totalTokens, totalTime, lastMessageTokens, lastDelta);
            markdown_content = '';
            setModel (lastModelUsed);
            setCurrentFineTune(fine_tune);
            receivingMessage = null;
        }


        /* load messages so far and sets the currentChatId */
        async function loadConversation (chat_id) {
            var $messages = $('.messages');
            let url = new URL('/chat/api/chatTopic', httpBase);
            let params = new URLSearchParams(url.search);
            params.append('session_id', session.info.sessionId);
            params.append('chat_id', chat_id);
            $('.loader').show();
            try {
                url.search = params.toString();
                const resp = await authClient.fetch (url.toString());
                if (resp.ok) {
                    let list = await resp.json();
                    let loadResult = showConversation (list);
                    $('.messages').find('.cursor').remove();
                    currentChatId = chat_id;
                    setCurrentChat(chat_id);
                    initFunctionList();
                    if (sharedItem.length > 0 && $(sharedItem).length > 0) {
                        // This is the whole point to have prompt_id shared between UI & backend, more or less for the line below
                        $messages.scrollTop($(sharedItem).offset().top - $('.top_menu').outerHeight() - 25);
                        sharedItem = '';
                    } else {
                        $messages.scrollTop($messages.prop('scrollHeight'));
                    }
                } else
                    showNotice ('Conversation failed to load failed: ' + resp.statusText);
            } catch (e) {
                showNotice('Loading conversation failed: ' + e);
            }
            $('.loader').hide();
            return;
        }
        async function sendOpener() {
            if (apiKeyRequired && !apiKey) return;
            if (!openerObj) return;
            let module = openerObj.fineTuneId;
            if (module && !$('#system-'+module).length) {
                logoutOnError = false;
                $('#error-modal .modal-body h4').text('Invalid module');
                $('#error-modal .modal-body p').text(`The requested module ${openerObj.fineTuneId} cannot be found.`);
                $('#error-modal').modal('show');
                return;
            }
            let text = module ? null : openerObj.text;
            let module_id = module ? 'system-'+module : null;
            let more = module ? openerObj.text : null;
            promptComplete(openerObj.prompt_id, text, 'user', module_id, enabledCallbacks, more);
            openerObj = undefined;
        }
        onOpen = function(event) {
            chatAuthenticate().then(() => {
                if (!helloSent) { /* send init message e.g. Init or something else to cause Chat bot to answer */
                    if (openerObj) {
                        setModel (openerObj.model);
                        sendMessage (openerObj.prompt_id, openerObj.text, 'left');
                        sendOpener();
                    }
                    else if (null != currentChatId) {
                        loadConversation(currentChatId);
                    }
                    helloSent = true;
                }
            });
        };
        onMessage = function(event) { /* self explanatory */
            $('.loader').hide();
            readMessage (event.data);
        };
        onError = function(event) {
            sendMessage (undefined, 'Error connecting to the server.', 'right');
            $('.loader').hide();
            $('.message_input').prop('disabled', true);
            webSocket.close();
        };
        onClose = function (event) {
            sendMessage (undefined, 'Connection to the server closed.', 'right');
            $('.send_message').hide();
            $('.loader').hide();
            $('.reconnect').show();
            $('.message_input').prop('disabled', true);
        };
        function promptComplete (prompt_id = null, text, role = 'user', chat_id = currentChatId, call_funcs = enabledCallbacks, more = null) {
            let images = new Array();
            let image_resolution = 'low';
            if ($('#image_resolution').is(':checked')) {
                image_resolution = 'high';
            }
            $('img[data-url][class="user-img-src"]').each (function () {
                var imageUrl = $(this).attr('data-url');
                images.push (imageUrl);
                $(this).removeAttr('data-url');
                $(this).next('.user-img-remove').hide();
            });
            if ($('.messages .user-image').length > 0 && -1 == currentModel.indexOf('vision') && -1 ==  currentModel.indexOf('dall-e')) {
                logoutOnError = false;
                $('#error-modal .modal-body h4').text('Model not allowed');
                $('#error-modal .modal-body p').text(`The model ${currentModel} do not support images.`);
                $('#error-modal').modal('show');
                $('.loader').hide();
                return;
            }
            // check model if there is image
            if (null === text || 'user' !== role || !images.length || -1 == currentModel.indexOf('vision')) { images = null; }
            let request = {
                type: role,
                question: text,
                chat_id: chat_id,
                model: currentModel,
                call: (-1 == currentModel.indexOf('vision')) ? call_funcs : [],
                apiKey: apiKey,
                temperature: temperature,
                top_p: top_p,
                prompt_id: prompt_id,
                images: images,
                image_resolution: image_resolution,
                max_tokens: max_tokens,
                alt_question: more,
            };
            webSocket.send(JSON.stringify(request));
            $('.message_input').val('');
            $('.message_input').parent().attr('data-replicated-value', '');
        }
        /* next two are to send questions to server endpoint */
        $('.send_message').click(function (e) {
            var text = getMessageText();
            if (loggedIn) {
                let prompt_id = getPromptId();
                sendMessage(prompt_id, text, 'left');
                if (typeof (webSocket) === 'undefined' || text.trim() === '')
                  return;
                $('.loader').show();
                cancelContinueAction ();
                promptComplete(prompt_id, text);
                return;
            }
            else {
               showNotice ('Not logged in');
               return;
            }
        });
        $('.message_input').on('input', function() {
            this.parentNode.dataset.replicatedValue = this.value;
        });
        $('.message_input').on('keyup', function() {
            this.parentNode.dataset.replicatedValue = this.value;
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
                    let prompt_id = getPromptId();
                    sendMessage(prompt_id, text, 'left');
                    $('.loader').show();
                    cancelContinueAction ();
                    promptComplete(prompt_id, text);
                    return;
                }
                else {
                    showNotice ('Not logged in');
                    return;
                }
            }
        });
        $('.reconnect').click(function (e) { /* self explanatory */
            webSocket = new WebSocket(wsUrl.toString());
            sendMessage(undefined, 'Connected', 'right');
            webSocket.onopen = onOpen;
            webSocket.onmessage = onMessage;
            webSocket.onerror = onError;
            webSocket.onclose = onClose;
            $('.reconnect').hide();
            $('.message_input').prop('disabled', false);
            $('.send_message').show();
        });
        $('.continue').click(function (e) {
            let lastBreak = markdown_content.lastIndexOf ('\n');
            let lastLine = lastBreak != -1 ? '\n' + markdown_content.substring(lastBreak) : '';
            promptComplete(undefined, 'continue'+lastLine, 'system');
            $('.loader').show();
            $('.continue_wrapper').hide();
            $('.stop_wrapper').show();
        });
        $('.stop').click(function (e) {
            let url = new URL('/chat/api/chatControl', httpBase);
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
                 oidcIssuer: httpBase,
                 redirectUrl: url.toString(),
                 tokenType: authType,
                 clientName: 'OpenLink Personal Assistant'
            });
        }

        $('.continue_session').click(function (e) {
            let url = new URL(window.location.href);
            let params = new URLSearchParams(url.search);
            let chat_id = params.get('chat_id');
            localStorage.setItem ('openlinksw.com:opal:copy:id', chat_id);
            url.search = '';
            url.hash = '';
            authClient.login({
                 oidcIssuer: httpBase,
                 redirectUrl: url.toString(),
                 tokenType: authType,
                 clientName: 'OpenLink Personal Assistant'
            });
        });

        async function loadProfile(webId) {
            var uriObj = new URL(webId);
            let hash = uriObj.hash;
            uriObj.hash = uriObj.search = uriObj.query = '';
            if (hash === '#this') {
                webId = uriObj.toString();
            }
            if (!webId.startsWith('https://')) return;
            try {
                var rc = await fetchProfile(webId);
                if (!rc)
                    return null;


                var base = uriObj.toString()
                let mediaType = rc.content_type;
                let bodyText = rc.profile;

                if (mediaType.startsWith('text/html')) {
                    let parser = new DOMParser();
                    let doc = parser.parseFromString(bodyText, 'text/html');
                    let storage_link = doc.querySelector(`*[itemid="${webId}"] > link[itemprop="http://www.w3.org/ns/pim/space#storage"]`);
                    let inbox_link = doc.querySelector(`*[itemid="${webId}"] > link[itemprop="http://www.w3.org/ns/pim/space#inbox"]`);
                    let name_meta = doc.querySelector(`*[itemid="${webId}"] > meta[itemprop="http://schema.org/name"]`);
                    let storage_url = storage_link ? storage_link.href : inbox_link ? inbox_link.href : null;
                    if (storage_url) {
                        let isDav = await isDavSupported (storage_url);
                        return {
                            storage: storage_url,
                            is_solid_id: false,
                            isDav: isDav,
                            name: name_meta ? name_meta.content : null
                        }
                    }
                }

                const store = $rdf.graph()
                $rdf.parse(bodyText, store, base, mediaType);
                const LDP = $rdf.Namespace("http://www.w3.org/ns/ldp#");
                const PIM = $rdf.Namespace("http://www.w3.org/ns/pim/space#");
                const SOLID = $rdf.Namespace("http://www.w3.org/ns/solid/terms#");
                const FOAF = $rdf.Namespace("http://xmlns.com/foaf/0.1/");

                const s_webId = $rdf.sym(webId)

                var storage = store.any(s_webId, PIM('storage'));
                var inbox = store.any(s_webId, LDP('inbox'));
                var name = store.any(s_webId, FOAF('name'));

                var s_issuer = store.any(s_webId, SOLID('oidcIssuer'));
                var s_account = store.any(s_webId, SOLID('account'));
                var s_pubIndex = store.any(s_webId, SOLID('publicTypeIndex'));
                var is_solid_id = (s_issuer || s_account || s_pubIndex) ? true : false;
                let storage_url = storage ? storage.value : inbox ? inbox.value : null;
                let isDav = await isDavSupported (storage_url);
                return {
                    storage: storage_url,
                    is_solid_id: is_solid_id,
                    isDav: isDav,
                    name: name
                };

            } catch (e) {
                console.error('Error', e)
                return null;
            }
        }

        async function fetchProfile(url) {

            const options = {
                method: 'GET',
                headers: { 'Accept': 'text/turtle, application/ld+json;q=0.9, application/rdf+xml;q=0.2, */*;q=0.1' },
                mode: 'cors',
                crossDomain: true,
            };

            var resp;
            try {
                resp = await fetch(url, options);
                if (resp.ok) {
                    var body = await resp.text();
                    var contentType = resp.headers.get('content-type');
                    return { profile: body, content_type: contentType };
                }
                else {
                    console.log("Error " + resp.status + " - " + resp.statusText)
                }
            }
            catch (e) {
                console.error('Request failed', e)
                return null;
            }
        }

        async function updateLoginState() {
            if (loggedIn) {
                let params = new URLSearchParams(wsUrl.search);
                let resume = localStorage.getItem('openlinksw.com:opal:copy:id');
                let opener = localStorage.getItem('openlinksw.com:opal:opener');
                if (opener) {
                    openerObj = JSON.parse(opener);
                }
                localStorage.removeItem('openlinksw.com:opal:opener');
                localStorage.removeItem('openlinksw.com:opal:copy:id');
                params.append('sessionId',session.info.sessionId);
                wsUrl.search = params.toString();

                $('.loggedin-btn').show();
                $('.loggedin-btn').attr('href', session.info.webId);
                $('.loggedin-btn').attr('title', session.info.webId);
                $('.loggedin-btn').tooltip({container: 'body'});

                /* init the left drop down side bar and sets the currentChatId */
                await initSidebar();

                if (session.info.webId != null) {
                    /*showNotice ('Logged as ' + session.info.webId);*/
                    loadProfile(session.info.webId)
                        .then(response => {
                            if (response && response.storage && response.storage.startsWith('https://') && response.isDav) {
                                storageFolder = response.storage;
                                $("#storage-folder").prop('disabled', false);
                                $('#import-btn').show();
                                $('#export-btn').show();
                            }
                            $('#storage-folder').val(storageFolder);
                        })
                        .catch((err) => { console.log(err.toString()); });
                }

                $('#api-key-modal-btn').show();

                if (null != resume && !sessionRestored) {
                    await resumeAsNew(resume);
                    await loadConversation (currentChatId);
                }
                /* this connect only, the authentication is onOpen hook/chatAuthenticate */
                webSocket = new WebSocket(wsUrl.toString());
                $('.reconnect').hide();
                webSocket.onopen = onOpen;
                webSocket.onmessage = onMessage;
                webSocket.onerror = onError;
                webSocket.onclose = onClose;
                if (chatSessionTimeoutMsec >= 10000) {
                    setTimeout(function() {
                        logoutOnError = true;
                        $('#error-modal .modal-body h4').text('Session has expired');
                        $('#error-modal .modal-body p').text('You will need to re-authenticate in order to continue.');
                        $('#error-modal').modal('show');
                    }, chatSessionTimeoutMsec);
                }
            } else if (openerObj) {
                authLogin();
            }
        }

        async function authLogout() {
            let url = new URL(window.location.href);
            url.search = '';
            url.hash = '';
            await authClient.logout();
            localStorage.removeItem('openlinksw.com:opal:gpt-api-key');
            localStorage.removeItem('openlinksw.com:opal:copy:id');
            location.replace(url.toString());
        }
        /* baloon for warnings an errors */
        async function showNotice (text) {
            const tm = 3000;
            $('#msg').html(text);
            $('#snackbar').show();
            setTimeout(function () {  $('#snackbar').hide(); }, tm);
        }

        function addSystemItems () {
            let $list_item = $($('.list-group-system-item-template').clone().html());
            $('.chat-sessions').append($list_item);
            $('#system-new').on ('click', function () { selectSession ('system-new'); });
            $('#import-btn').on ('click', function (e) { listStorage(e); });
            $('#export-btn').on ('click', function (e) {
                exportSession(currentChatId);
                $('#slide-submenu').closest('.chat-sessions').fadeOut('slide',function(){
                    $('.mini-submenu').fadeIn();
                });
            });
            $('#import-btn').hide();
            $('#export-btn').hide();
            $list_item.addClass ('list-group-item');
            return;
        }

        async function exportSession(chat_id) {
            if (!chat_id) {
                showNotice('No session is selected to export.');
                return;
            }
            $('.bd-modal-share').modal('hide');
            let url = new URL('/chat/api/chatTopic', httpBase);
            let params = new URLSearchParams(url.search);
            params.append('session_id', session.info.sessionId);
            params.append('chat_id', chat_id);
            params.append('includeMeta', 1);
            url.search = params.toString();
            $('.loader').show();
            let body = authClient.fetch (url.toString())
                .then(response => {
                    if (!response.ok) {
                        throw new Error(response.statusText);
                    }
                    return response.json();
                })
                .then ((body) => {
                    let title = body?.info?.title ? body.info.title : chat_id;
                    let file_name = title.replace(/[\s\/\\.]/g, '_') + '.json';
                    let url = new URL(encodeURIComponent(file_name), storageFolder);
                    const options = { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body, null, 2) };
                    authClient.fetch(url.toString(), options)
                        .then(response => {
                            if (!response.ok) {
                                throw new Error (response.statusText);
                            }
                            let location = response.headers.get('location');
                            let link = new URL (location, storageFolder);
                            $('#upload-location').attr('href', link.toString());
                            $('#upload-location').text(title);
                            return response.text();
                        })
                        .then((response) => {
                            $('.loader').hide();
                            $('#upload-status').modal('show');
                        })
                        .catch((err) => {
                            $('.loader').hide();
                            showNotice (err.message);
                        });
                })
                .catch((err) => {
                    $('.loader').hide();
                    showNotice (err.message);
                });
        }

        async function listStorage(e) {
            if (!storageFolder) return;
            const propfind = '<?xml version="1.0" encoding="utf-8" ?>'+
                '<D:propfind xmlns:D="DAV:" >'+
                '<D:prop><D:displayname/><D:getcontenttype/></D:prop>'+
                '</D:propfind>';
            const options = { method: 'PROPFIND', headers: {'content-type': 'application/xml', 'depth': 1}, body: propfind};
            $('.loader').show();
            authClient.fetch(storageFolder, options)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(response.statusText);
                    }
                    return response.text();
                })
                .then (xmlText => {
                    let parser = new DOMParser();
                    let xmlDoc = parser.parseFromString(xmlText, 'text/xml');
                    let propfindResponse = xmlDoc.getElementsByTagNameNS('DAV:', 'response');

                    $('.chat-sessions').find('.user-topic').remove();
                    for (var i = 0; i < propfindResponse.length; i++) {
                        let elem = propfindResponse[i];
                        let href = elem.getElementsByTagNameNS('DAV:','href')[0]?.textContent;
                        let title = elem.getElementsByTagNameNS('DAV:','displayname')[0]?.textContent;
                        let mime = elem.getElementsByTagNameNS('DAV:','getcontenttype')[0]?.textContent;
                        let url = new URL (href, storageFolder);
                        if (mime === 'application/json') {
                            addSidebarLink (url.toString(), title);
                        }
                    }
                })
                .catch((err) => { showNotice (err.message); });
            $('#import-btn').hide();
            $('#export-btn').hide();
            $('.loader').hide();
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

        function addSidebarLink (href, title) {
            var $list_item = $($('.list-group-item-template').clone().html());
            var $list_item_text = $list_item.children('.list-item-text');

            $list_item.addClass('list-group-item user-topic');
            $list_item.children('.list-item-edit').remove();
            $list_item_text.css('background-image', 'url("svg/file-text.svg")');
            $list_item_text.text(' '+ title);
            $list_item_text.on ('click', function () { loadFromStorage(href); });
            $list_item.children('.btn-delete').remove();
            $list_item.children('.btn-edit').remove();
            $('.chat-sessions').append($list_item);
        }

        async function loadFromStorage (link) {
            chatTopicsCacheReload();
            if (storageFolder) {
                $('#import-btn').show();
                $('#export-btn').show();
            }
            $('#slide-submenu').closest('.chat-sessions').fadeOut('slide',function(){
                $('.mini-submenu').fadeIn();
            });
            $('.loader').show();
            authClient.fetch (link, { method:'GET', headers: { 'Accept': 'application/json' } })
            .then ((res) => {
                if (!res.ok) {
                     throw new Error(res.statusText);
                }
                return res.json();
            })
            .then ((res) => {
                let list = res.messages;
                let info = res?.info;
                importedSession = res;
                showConversation (list);
                enabledCallbacks = info?.functions && info.functions instanceof Array ? info.functions : [];
                setEnabledFunctions();
                temperature = info?.temperature ? info?.temperature : 0.2;
                top_p = info?.top_p ? info.top_p : 0.5;
                $('.messages').scrollTop($('.messages').prop('scrollHeight'));
            })
            .catch ((e) => { showNotice (e.message); });
            $('.send_message').hide();
            $('.continue_session').show();
            $('.continue_session').off('click');
            $('.continue_session').click(function (e) {
                importSession();
            });
            $('.loader').hide();
        }

        async function importSession() {
            if (!importedSession || !loggedIn) return;
            let url = new URL('/chat/api/importTopic', httpBase);
            let params = new URLSearchParams();
            params.append('session_id', session.info.sessionId);
            url.search = params.toString();
            authClient.fetch (url.toString(), {method:'POST',headers: {'Accept':'application/json' },body:JSON.stringify(importedSession)})
            .then ((res) => {
                if (!res.ok) {
                    throw new Error(res.statusText);
                }
                return res.json();
            })
            .then ((obj) => {
                addSidebarItem (obj.chat_id, obj.title, 'now', lastChatId);
                currentChatId = obj.chat_id;
                setCurrentChat();
                initFunctionList();
                helloSent = true;
                $('.send_message').show();
                $('.continue_session').hide();
            })
            .catch ((e) => { showNotice (e.message); });
            importedSession = undefined;
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
            let url = new URL('/chat/api/createTopic', httpBase);
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

            if (approve === 'confirm') {
                let url = new URL('/chat/api/chatTopic', httpBase);
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

        async function setModel (model_id) {
            if (!model_id)
                return;
            const target_model = models.find((model) => model.id === model_id);
            $('#oai-model span.model').text(target_model.name);
            currentModel = model_id;

            if (-1 != currentModel.indexOf ('-32k')) {
                max_tokens = 32765;
            } else if (-1 != currentModel.indexOf ('-16k')) {
                max_tokens = 16384;
            } else if (-1 != currentModel.indexOf ('gpt-4') &&  -1 === currentModel.indexOf ('-preview')) {
                max_tokens = 8191;
            } else {
                max_tokens = 4095;
            }
            $('#max_tokens').val(max_tokens);
            $('#max_tokens_in').attr('max', max_tokens).val(max_tokens);

            if (currentModel.indexOf ('vision') != -1) {
                $('.image-btn').show();
                $('#available-functions li input[type="checkbox"]').each(function() {
                    $(this).prop('disabled', true);
                });
            } else {
                $('.image-btn').hide();
                $('#available-functions li input[type="checkbox"]').each(function() {
                    $(this).prop('disabled', false);
                });
            }

        }

        async function selectSession (id) {
            $('#slide-submenu').closest('.chat-sessions').fadeOut('slide',function(){
                $('.mini-submenu').fadeIn();
            });
            $('.messages').empty();
            if (-1 == id.indexOf ('system-'))
                await loadConversation (id);
            if (0 == id.indexOf ('system-') && typeof (webSocket) != 'undefined') {
                currentChatId = null;
                receivingMessage = null;
                $('.message_input').val('');
                promptComplete (undefined, null, 'user', id, null);
                $('.loader').show();
            }
        }

        async function initFineTune() {
            let $list = $('.fine-tune');
            try {
                let url = new URL('/chat/api/listFineTune', httpBase);
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
                $('.messages').empty();
                currentChatId = null;
                receivingMessage = null;
                $('.message_input').val('');
                promptComplete (undefined, null, 'user', id, null);
                $('.loader').show();
            } else {
               showNotice ('Not logged in');
            }
            setCurrentFineTune(id);
        }


        async function initFunctionList() {
            var funcList = $('#available-functions');
            try {
                let url = new URL('/chat/api/listFunctions', httpBase);
                let params = new URLSearchParams(url.search);
                params.append('chat_id', currentChatId != null ? currentChatId : sharedSession);
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
            setEnabledFunctions();
            $('#temperature').val(temperature);
            $('#temperature_in').val(temperature);
            $('#top_p').val(top_p);
            $('#top_p_in').val(top_p);
            $('#max_tokens').val(max_tokens);
            $('#max_tokens_in').val(max_tokens);
        }

        function setEnabledFunctions() {
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
        }

        async function getPlink () {
            let url = new URL('/chat/api/getPLink', httpBase);
            let params = new URLSearchParams(url.search);
            params.append('chat_id', currentChatId);
            url.search = params.toString();
            $('.loader').show();
            try {
                let resp = await authClient.fetch (url.toString());
                if (resp.ok) {
                    let share_id = await resp.text();
                    let linkUrl = new URL(pageUrl.toString());
                    linkUrl.search = 'chat_id=' + share_id;
                    $('.loader').hide();
                    return linkUrl.toString();
                } else {
                    showNotice ('Can not get share link' + resp.statusText);
                }
            } catch (e) {
                showNotice ('Can not get Permalink ' + e);
            }
            $('.loader').hide();
        }

        async function copyLinkToClipboard (prompt_id = null) {
            var hash = '';
            if (typeof prompt_id === 'string') {
                hash = '#' + prompt_id;
            }
            $('.bd-modal-share').modal('hide');
            if (typeof ClipboardItem != 'undefined') {
                const clipboardItem = new ClipboardItem({ 'text/plain': getPlink().then((url) => {
                    if (!url) {
                        return new Promise(async (resolve) => {
                            resolve(new Blob([""], { type:'text/plain' }))
                        })
                    }
                    return new Promise(async (resolve) => {
                        resolve(new Blob([url + hash],{ type:'text/plain' }))
                    })
                }),
                });
                navigator.clipboard.write([clipboardItem]).then(() => { showNotice('Permalink to the chat copied.'); },
                                                                () => { showNotice('Permalink copy failed.'); },);

            }
            else if (navigator.clipboard.writeText != 'undefined') {
                getPlink().then ((text) => {
                    navigator.clipboard.writeText(text).then(() => { showNotice('Permalink to the chat copied.'); },
                                                             () => { showNotice('Permalink copy failed.'); },);
                });
            } else {
                showNotice('Your browser does not support this function.');
            }
        }

        async function setPromptFlag(prompt_id) {
            let url = new URL('/chat/api/setPromptFlag', httpBase);
            let params = new URLSearchParams(url.search);
            let $prompt = $('#'+prompt_id);
            let verified = parseInt($prompt.attr('data-verified')) ? 0 : 1;
            if (!$prompt) {
                return;
            }
            params.append('chat_id', currentChatId);
            params.append('prompt_id', prompt_id);
            params.append('verified', verified);
            url.search = params.toString();
            $('.loader').show();
            authClient.fetch (url.toString()).then((resp) => {
                if (!resp.ok) {
                    throw Error ("Can not execute Like");
                }
                return resp.text();
            }).then ((text) => {
                $prompt.find('.like img').attr('src', verified ? 'svg/star-fill.svg' : 'svg/star.svg');
                $prompt.attr('data-verified', verified);
                $('.loader').hide();
            }).catch((err) => {
                console.log ('Error:'+err);
                $('.loader').hide();
            });
        }

        async function chatListReload() {
            $('.chat-sessions').find('.user-topic').remove();
            $('.chat-sessions').find('.system-topic').remove();
            $('.filter-input').val('');
            lastSearch = '';
            $('.btn-fliter-clear').hide();
            addSystemItems();
            if (storageFolder) {
                $('#import-btn').show();
                $('#export-btn').show();
            }
            loadChats();
        }

        async function chatTopicsCacheReload() {
            $('.chat-sessions').find('.user-topic').remove();
            $('.filter-input').val('');
            $('.btn-fliter-clear').hide();
            lastSearch = '';
            chatTopicsCache.slice(0,20).forEach (function (item) {
                addSidebarItem (item.chat_id,
                                item.title,
                                item.ts != null ? ' <span class="timestamp">(' + timeSince(item.ts) + ')</span>' : '');
            });
            setCurrentChat();
        }

        function setStats(total, elapsed, tokens, delta) {
            if (!total) { 
                return;
            }
            if (total < 1) {
                $('.stats').html('');
                return;
            }
            if (undefined != tokens && undefined != delta && loggedIn) {
                $('.stats').html(`Last: ${tokens} tokens in ${delta/1000}s, Total: ${total} tokens, duration ${TimeHms(elapsed)}`);
            } else {
                $('.stats').html(`Total: ${total} tokens, duration: ${TimeHms(elapsed)}`);
            }
        }


        async function initSidebar () {
            $('#slide-submenu').on('click',function() {
                $('.chat-sessions').fadeOut('slide',function(){
                    $('.mini-submenu').fadeIn();
                });
            });

            $('.mini-submenu').on('click', function(e){
                $('.chat-sessions').toggle('slide');
                $('.mini-submenu').hide();
            })

            /* user chats */
            addSystemItems();
            await loadChats ();

            /* init sharedSession copy */
            $('#share-btn').click(copyLinkToClipboard);

            $('#copy-btn').on('click', function (e) {
                if (null === currentChatId) {
                    return;
                }
                $('.bd-modal-share').modal('hide');
                let url = new URL('/chat/api/chatTopic', httpBase);
                let params = new URLSearchParams(url.search);
                params.append('session_id', session.info.sessionId);
                params.append('chat_id', currentChatId);
                params.append('includeMeta', 1);
                url.search = params.toString();
                $('.loader').show();
                try {
                    if (typeof ClipboardItem != 'undefined') {
                        const clipboardItem = new ClipboardItem(
                            { 'text/plain': authClient.fetch (url.toString()).
                                then((response) => {
                                    $('.loader').hide();
                                    if (!response.ok)
                                        throw new Error ("Can not retrieve session log");
                                    return response.json();
                                }).
                                then((json) => {
                                    let body = '';
                                    body += `### ${json.info.title}\n`;
                                    json.messages.forEach(item => {
                                        if ('tool' === item.role || 'function' === item.role) {
                                            body += `\n**${item.role}:**\n` + "```\n" + `${item.text}` + "\n```\n";
                                        } else if ('image' === item.role) {
                                            body += `\n![image](${item.dataUrl})\n`
                                        } else if ('system' === item.role) {
                                            /* skip continue markers */
                                        } else if (null != item.text) {
                                            body += `\n**${item.role}:**\n ${item.text}\n`;
                                        } else if (null != item.func) {
                                            body += `\n**${item.func_title}**\n`+ "```\n"+ `${item.func_args}` + "\n```\n";
                                        }
                                    });
                                    return new Promise(async (resolve) => {
                                        resolve(new Blob([body],{ type:'text/plain' }))
                                    })
                                }),
                        });
                        navigator.clipboard.write([clipboardItem]).then(() => { showNotice('Successfully saved chat to Clipboard.'); },
                                                                        (e) => { showNotice('Copy failed:' + e); },);

                    }
                    else if (navigator.clipboard.writeText != 'undefined') {
                        authClient.fetch (url.toString()).
                            then((response) => {
                                $('.loader').hide();
                                if (!response.ok)
                                    throw new Error ("Can not retrieve session log");
                                return response.json();
                            }).
                            then ((body) => {
                                navigator.clipboard.writeText(JSON.stringify(body, null, 2)).
                                    then(() => { showNotice('Successfully saved chat to Clipboard.'); },
                                         (e) => { showNotice('Copy failed:'+e); },);
                            });
                    } else {
                        showNotice('Your browser does not support this function.');
                    }
                } catch (e) {
                    $('.loader').hide();
                    showNotice(e.toString());
                }
            });

            $('#upload-btn').click(function (e) {
                if (null === currentChatId || null === storageFolder) {
                    return;
                }
                exportSession (currentChatId);
                return;
            });

            $('#topics-refresh').on('click', chatListReload);
            $('.btn-fliter-clear').on('click', chatTopicsCacheReload);

            async function chatListFilter (word) {
                if (ftSearch) {
                    freeTextTopicSearch (word);
                    return;
                }
                const result = chatTopicsCache.filter((item) => item.title?.toUpperCase().indexOf(word.toUpperCase()) != -1);
                $('.btn-fliter-clear').show();
                $('.chat-sessions').find('.user-topic').remove();
                result.forEach (function (item) {
                    addSidebarItem (item.chat_id,
                                    item.title,
                                    item.ts != null ? ' <span class="timestamp">(' + timeSince(item.ts) + ')</span>' : '');
                    lastSearch = word;
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
                let url = new URL('/chat/api/searchChats', httpBase);
                let params = new URLSearchParams(url.search);
                params.append('query', query);
                params.append('n', max_items);
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
                        showNotice ('Filter `'+query+'` does not match any topic');
                    }
                } else
                    showNotice ('Filtering chats failed: ' + resp.statusText);
            } catch (e) {
                showNotice('Filtering chats failed: ' + e);
            }
            $('.loader').hide();
            return;
        }

        function makeDataUrl () {
            let canvas = document.createElement('canvas');
            let context = canvas.getContext('2d');
            let h = this.naturalHeight, w = this.naturalWidth;
            /*
            let scale = h / w, ratio = 1;
            console.log ('h ', h, ' w ' , w);
            if (h >= 480 || w >= 640) {
                if (h > 480) {
                  h = 480; w = h / scale;
                }
                if (w > 640) {
                    w = 640; h = w * scale;
                }
                console.log ('scaled h ', h, ' w ' , w);
            } */
            canvas.height = h;
            canvas.width = w;
            context.drawImage(this, 0, 0);
            let dataURL = canvas.toDataURL('image/jpeg');
            this.setAttribute('data-url', dataURL);
         }

        /* default models */
        let model_names = [ 'gpt-3.5-turbo-0301', 'gpt-3.5-turbo-0613', 'gpt-3.5-turbo-16k-0613', 'gpt-3.5-turbo-16k', 'gpt-3.5-turbo', 'gpt-4-0314', 'gpt-4-0613', 'gpt-4' ];
        var models = [];
        model_names.reverse().forEach((item) => {
            models.push({id:item, name:item});
        });

        function initModels (items) {
            items.forEach (function(item) {
                $('#oai-model-id').append(`<li><a href="#" id="${item.id}" class="dropdown-item gpt-model">${item.name}</a></li>`);
            });
            $('.dropdown-menu a.gpt-model').click(function(e){ setModel(this.id); e.preventDefault(); });
        }

        try {
            let url = new URL('/chat/api/getModels', httpBase);
            fetch (url.toString()).then (resp => {
                if (resp.ok) {
                    return resp.json();
                } else {
                    initModels(models);
                    console.log ('Can not get models: '+resp.statusText + ' setting defaults');
                }
            }).then(items => {
                if (items.length > 0) {
                    models = items;
                }
                initModels(models);
            });
        } catch (e) {
            showNotice('Model list failed.');
        }



        let url = new URL(window.location.href);
        let params = new URLSearchParams(url.search);
        let restore = !params.has('chat_id');
        let text = pageParams.get('prompt');
        if (text) {
            openerObj = { prompt_id: getPromptId(), model: pageParams.get('model'), fineTuneId: pageParams.get('module'), text: text };
            localStorage.setItem ('openlinksw.com:opal:opener', JSON.stringify(openerObj));
        }
        params.delete('model');
        params.delete('module');
        params.delete('prompt');
        url.search = params.toString();

        authClient.handleIncomingRedirect({url: url.toString(), restorePreviousSession: restore}).then ((info) => {
                loggedIn = info?.isLoggedIn ? info.isLoggedIn : false;
                $('#loginID').toggleClass('d-none', loggedIn);
                $('#logoutID').toggleClass('d-none', !loggedIn);
                updateLoginState();
            }).catch ((e) => { showNotice ('Failed to restore session: '+e); });

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
        if (null != sharedSession) {
            loadConversation(sharedSession);
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
            if (apiKey.length) {
                localStorage.setItem ('openlinksw.com:opal:gpt-api-key', apiKey);
            }
            if (apiKey.length || !apiKeyRequired) {
                $('.key-icon').attr('src', 'svg/unlock.svg');
            } else {
                apiKey = null;
                $('.key-icon').attr('src', 'svg/key.svg');
            }
            $('#api-key-modal').modal('hide');
            sendOpener();
        });
        $('#api-key').keypress(function (e) {
            if (e.which === 13 && this.value.length > 1) {
                apiKey = this.value;
                localStorage.setItem ('openlinksw.com:opal:gpt-api-key', apiKey);
                $('.key-icon').attr('src', 'svg/unlock.svg');
                $('#api-key-modal').modal('hide');
                sendOpener();
            }
        });
        $('#api-key-modal').on('shown.bs.modal', function () {
            $('#api-key').focus();
        })
        $('#btn-api-key-remove').click (function () {
            $('#api-key').val('');
            apiKey = null;
            localStorage.removeItem('openlinksw.com:opal:gpt-api-key');
            if (apiKeyRequired) {
                $('.key-icon').attr('src', 'svg/key.svg');
            }
            $('#api-key-modal').modal('hide');
        });
        $('#temperature_in').on("input", function(e) {
            temperature = parseFloat (e.target.value);
            $('#temperature').val(e.target.value);
        });
        $('#temperature').on("input", function(e) {
            temperature = parseFloat (e.target.value);
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
        $('#max_tokens_in').on("input", function(e) {
            max_tokens = parseInt (e.target.value);
            $('#max_tokens').val(e.target.value);
        });
        $('#max_tokens').on("input", function(e) {
            max_tokens = parseInt (e.target.value);
            $('#max_tokens_in').val(e.target.value);
        });
        $('#max_items_in').on("input", function(e) {
            max_items = parseInt (e.target.value);
            $('#max_items').val(e.target.value);
        });
        $('#max_items').on("input", function(e) {
            max_items = parseInt (e.target.value);
            $('#max_items_in').val(e.target.value);
        });
        $('#max_items_in').val(max_items);
        $('#fn-debug').on('click', function(e) {
            let $messages = $('.messages');
            $('.message.middle').toggleClass('d-none', !e.target.checked);
            if (e.target.checked) {
                $messages.animate({ scrollTop: $messages.prop('scrollHeight') }, 0);
            }
        });
        if (undefined === navigator.mediaDevices.getUserMedia || typeof (enableVoice) === 'undefined' || !enableVoice) {
            $('#audio-ctl').hide();
          }
        $('#enable_audio').on('click', function(e) {
            if (e.target.checked) {
                audioEnable ();
            } else {
                audioDisable();
            }
        });
        $('#start-btn').on ('click', startRecording);
        $('#stop-btn').on ('click', stopRecording);

        $("#storage-folder").prop('disabled', true);
        $('#storage-folder').on('keyup', (e) => { storageFolder = e.currentTarget.value; });
        $('.bd-modal-share').on('show.bs.modal', function (e) {
            if (!loggedIn) return e.preventDefault();
        })

        $('.image-btn').on('click', function(){ $('#img-upload').trigger('click'); });
        $('.image-btn').hide();

        $('#img-upload').on('change', function(e) {
            var $messages = $(".messages");
            for (const file of e.currentTarget.files) {
                if (!file.type || !file.type.startsWith('image/')) {
                    showNotice(`Only files of type 'image' are allowed for upload, not files of type ${file.type}`);
                    continue;
                }

                if (file.size > 7500000) {
                    showNotice(`File is too large ${file.size}, please reduce image size.`);
                    continue;
                }

                let imgURL = URL.createObjectURL(file);
                let $div = $($('.image-upload-template').clone().html());
                let $img = $div.find('.user-img-src');
                $img.on('load', makeDataUrl);
                $img.attr("src", imgURL);
                $div.find('.user-img-remove').on('click', function (e) {
                    $($div).remove();
                });

                $div.find('.user-img-zoom-in').on('click', function (e) {
                    let $img = $(this).siblings('.user-img-src');
                    let height = $img.height();
                    height += 50;
                    if (height >= 480) return;
                    $img.height(height);
                });

                $div.find('.user-img-zoom-out').on('click', function (e) {
                    let $img = $(this).siblings('.user-img-src');
                    let height = $img.height();
                    height -= 50;
                    if (height <= 120) return;
                    $img.height(height);
                });

                $div.show();
                $messages.append($div);
            }
            $messages.animate({ scrollTop: $messages.prop('scrollHeight') }, 300);
            $('#img-upload').val('');
        });

        $("#error-modal").on("hidden.bs.modal", function () {
            if (logoutOnError) {
                authLogout();
            }
            logoutOnError = false;
        });

    });
}.call(this));

