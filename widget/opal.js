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

class Opal {
    constructor (authClient = null, host = null, cb = null, ecb = null, data = {}) {
        let pageUrl = new URL(window.location);
        let thisHost = host ? host : pageUrl.host;
        this.version = 1.1;
        this.messages_sent = 0;
        this.authClient = authClient ? authClient : solidClientAuthentication?.default;
        this.session = this.authClient ? this.authClient.getDefaultSession() : undefined;
        this.wsUrl = new URL('wss://' + thisHost + '/ws/chat');
        this.apiBaseUrl = 'https://' + thisHost + '/chat/api/';
        this.model = data?.model ? data.model : 'gpt-4';
        this.top_p = data?.top_p ? data.top_p : 0.5;
        this.temperature = data?.temperature ? data.temperature : 0.2;
        this.apiKey = data?.apiKey ? data.apiKey : null;
        this.module = data?.module;
        this.supportedAudioType = data?.audio_media_type ? data?.audio_media_type : null;
        this.ws = undefined;
        this.chat_id = undefined;
        this.functions = data?.functions ? data.functions : [];
        this.messageCallback = typeof cb === 'function' ? cb : stubCallback;
        this.errorCallback = typeof ecb === 'function' ? ecb : stubError;
    }

    stubCallback (kind, data) {
        // do nothing
    }

    stubError(error) {
        throw(error);
    }

    async authenticate () {
        let url = new URL('chatAuthenticate', this.apiBaseUrl);
        let params = new URLSearchParams(url.search);
        params.append('session_id', this.session.info.sessionId);
        url.search = params.toString();
        this.authClient.fetch (url.toString(), { headers: { 'X-OPAL-Version': this.version, }, }).then((resp) => {
            if (resp.ok) {
                return resp.json();
            }
            throw Error ('Can not authenticate');
        }).then((data) => {
            if (data.apiKeyRequired) {
                this.errorCallback('Your login is not authorized to ask OPAL');
            }
        });
    }

    async connect () {
        if (!this.session?.info?.isLoggedIn) {
            throw Error ('Not logged-in');
        }
        let params = new URLSearchParams();
        params.append ('sessionId',this.session.info.sessionId);
        this.wsUrl.search = params.toString();
        this.ws = new WebSocket (this.wsUrl.toString ());

        this.ws.onopen = this.onOpen.bind(this);
        this.ws.onclose = this.onClose.bind(this);
        this.ws.onmessage = this.onMessage.bind(this);
        this.ws.onerror = this.onError.bind(this);
    }

    onOpen (event) {
        this.authenticate().then(() => this.chatInfo()).catch ((error) => this.errorCallback(error));
    }

    onClose (event) {
        this.ws = undefined;
        this.chat_id = undefined;
    }

    onMessage (event) {
        try {
            let obj = JSON.parse(event.data);
            this.messageCallback(obj.kind, obj.data);
            if ((obj.data.trim() === '[DONE]' || obj.data.trim() === '[LENGTH]') && !this.chat_id) {
                this.chatInfo();
            }
        } catch (e) {
            this.errorCallback(e);
        }
    }

    onError (event) {
        this.errorCallback('Connection error')
    }

    async chatInfo() {
        let url = new URL('getTopic', this.apiBaseUrl);
        let params = new URLSearchParams(url.search);
        params.append('session_id', this.session.info.sessionId);
        url.search = params.toString();
        this.authClient.fetch (url.toString(), { headers: { 'X-OPAL-Version': this.version, }, }).then((resp) => {
            if (resp.status != 200) {
                throw Error ('Can not get chat log Id');
            }
            return resp.json();
        }).then((data) => {
            this.chat_id = data?.chat_id;
        });
    }

    getPromptId () {
        return Math.random().toString(36).replace('0.','usr-');
    }

    async send(text, images = null, options = null) {
        let prompt_id = this.getPromptId();
        text = text ? text.trim() : null;
        if (!text || !text.length) {
            return;
        }
        if (!this.chat_id) {
            let error_message = this.session?.info && !this.session?.info.isLoggedIn ? 'You are not logged in' :
                'The chat session is not established';
            this.errorCallback (error_message);
            return;
        }
        let chat_id = this.chat_id;
        let alt = null;
        // the first prompt sends together config and prompt
        if (this.module && !this.messages_sent) {
            chat_id = 'system-'+this.module;
            alt = text;
            text = null;
            this.chat_id = null;
        }
        let request = {
            type: 'user',
            question: text,
            chat_id: chat_id,
            model: this.model,
            call: this.functions,
            apiKey: this.apiKey,
            temperature: this.temperature,
            top_p: this.top_p,
            prompt_id: prompt_id,
            images: images,
            image_resolution: options?.image_resolution != undefined ? options.image_resolution : null,
            max_tokens: options?.max_tokens != undefined ? options.max_tokens : null,
            alt_question: alt,
        };
        this.ws.send(JSON.stringify(request));
        this.messages_sent++;
    }

    setAudioFormat(mime) {
        this.supportedAudioType = mime;
    }

    async transcibe(blob) {
        let url = new URL('voice2text', this.apiBaseUrl);
        const formData  = new FormData();
        if (!this.supportedAudioType) {
            this.errorCallback ('Supported audio format is not set.');
            return;
        }
        formData.append('format', this.supportedAudioType);
        if (null != this.apiKey) {
            formData.append('apiKey', this.apiKey);
        }
        formData.append('data', blob);
        try {
            const resp = await this.authClient.fetch (url.toString(), { method: 'POST', body: formData, headers: { 'X-OPAL-Version': this.version, }, });
            if (resp.ok) {
                let jt = await resp.json();
                let text = jt.text;
                if (text.length) {
                    this.messageCallback ('transcription', text);
                    return text;
                } else {
                    this.errorCallback ('Recording cannot be transcribed.');
                }
            } else {
                this.errorCallback ('Can not access voice transcription service ' + resp.statusText);
            }
        } catch (e) {
            this.errorCallback ('Can not access voice transcription service ' + e);
        }
    }

    async getPermaLink() {
        let url = new URL('getPLink', this.apiBaseUrl);
        let params = new URLSearchParams(url.search);
        if (!this.chat_id) {
            throw Error ('No active chat session.');
        }
        params.append('chat_id', this.chat_id);
        url.search = params.toString();
        try {
            let resp = await this.authClient.fetch (url.toString(), { headers: { 'X-OPAL-Version': this.version, }, });
            if (resp.ok) {
                let share_id = await resp.text();
                let linkUrl = new URL('/chat/', this.apiBaseUrl);
                linkUrl.search = 'chat_id=' + share_id;
                return linkUrl.toString();
            } else {
                this.errorCallback ('Can not get Permalink ' + resp.statusText);
            }
        } catch (e) {
            this.errorCallback ('Can not get Permalink ' + e);
        }
    }

    async share (mode) {
        if (typeof ClipboardItem != 'undefined') {
            const clipboardItem = new ClipboardItem({ 'text/plain': this.getPermaLink().then((url) => {
                if (!url) {
                    throw Error ('Can not get permalink');
                }
                return new Promise(async (resolve) => {
                    resolve(new Blob([url],{ type:'text/plain' }))
                })
            }),
            });
            navigator.clipboard.write([clipboardItem]).then(() => { this.messageCallback('notice', 'Permalink to the chat copied.'); },
                                                            () => { this.errorCallback('Permalink copy failed.'); },);
        }
        else if (navigator.clipboard.writeText != 'undefined') {
            this.getPermaLink().then ((text) => {
                navigator.clipboard.writeText(text).then(() => { this.messageCallback('notice', 'Permalink to the chat copied.'); },
                                                         () => { this.errorCallback('Permalink copy failed.'); },);
            });
        } else {
            this.errorCallback('Your browser does not support this function.');
        }
    }

    async close() {
        this.ws.close();
        this.chat_id = undefined;
    }
}

