import * as path from 'path';
import { createStore, Store } from 'redux';
import { getLocal, Mockttp } from 'mockttp';
import { CompletedRequest, CompletedResponse } from '../types';

export type HttpExchange = {
    request: CompletedRequest;
    response?: CompletedResponse;
};

export interface StoreModel {
    server: Mockttp,
    serverStatus: ServerStatus,
    exchanges: HttpExchange[];
}

export enum ServerStatus {
    Connecting,
    Connected,
    AlreadyInUse,
    UnknownError
}

export type Action =
    { type: 'UpdateServerStatus', value: ServerStatus } |
    { type: 'RequestReceived', request: CompletedRequest } |
    { type: 'ResponseCompleted', response: CompletedResponse };

const reducer = (state: StoreModel, action: Action): StoreModel => {
    switch (action.type) {
        case 'RequestReceived':
            return Object.assign({}, state, {
                exchanges: state.exchanges.concat({ request: action.request })
            });
        case 'ResponseCompleted':
            return Object.assign({}, state, {
                exchanges: state.exchanges.map((exchange) => exchange.request.id === action.response.id ?
                    { ...exchange, response: action.response } : exchange)
            });
        case 'UpdateServerStatus':
            return Object.assign({}, state, { serverStatus: action.value });
        default:
            return state;
    }
}

export async function getStore(options: { https: boolean, configRoot: string }): Promise<Store<StoreModel>> {
    const server = getLocal({
        https: options.https ? {
            keyPath: path.join(options.configRoot, 'ca.key'),
            certPath: path.join(options.configRoot, 'ca.pem')
        }: undefined,
        cors: false
    });

    const store = createStore<StoreModel>(reducer, {
        server: server,
        serverStatus: ServerStatus.Connecting,
        exchanges: []
    });

    server.start(8000).then(async () => {
        await server.anyRequest().always().thenPassThrough();

        console.log(`Server started on port ${server.port}`);

        store.dispatch<Action>({
            type: 'UpdateServerStatus',
            value: ServerStatus.Connected
        });

        server.on('request', (req) => store.dispatch<Action>({
            type: 'RequestReceived',
            request: req
        }));

        server.on('response', (res) => store.dispatch<Action>({
            type: 'ResponseCompleted',
            response: res
        }));

        window.addEventListener('beforeunload', () => server.stop());
    }).catch((err) => {
        if (err.response && err.response.status === 409) {
            console.info('Server already in use');
            store.dispatch<Action>({
                type: 'UpdateServerStatus',
                value: ServerStatus.AlreadyInUse
            });
        } else {
            store.dispatch<Action>({
                type: 'UpdateServerStatus',
                value: ServerStatus.UnknownError
            });
            console.error(err);
        }
    });

    return store;
}