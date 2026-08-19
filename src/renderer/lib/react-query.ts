import type {
    DefaultOptions,
    QueryOptions,
    UseInfiniteQueryOptions,
    UseMutationOptions,
    UseQueryOptions,
} from '@tanstack/react-query';

import { QueryCache, QueryClient } from '@tanstack/react-query';

import { toast } from '/@/shared/components/toast/toast';

const queryCache = new QueryCache({
    onError: (error: any, query) => {
        if (query.state.data !== undefined) {
            console.error(error);
            toast.show({ message: `${error.message}`, type: 'error' });
        }
    },
});

const queryConfig: DefaultOptions = {
    mutations: {
        // No blind retries. Every API layer collapses its transport error into a bare
        // `Error` (the ts-rest `api:` adapters in *-api.ts catch the AxiosError and turn
        // it into a `{ status }` response, and the controllers then throw
        // `new Error('Failed to ...')`), so nothing here can tell a definite rejection
        // apart from a transient blip — a status-aware predicate would have nothing to
        // read. Retrying blind is wrong for the mutations we actually have:
        //   - non-idempotent writes (add-to-playlist, create-playlist, create-radio-
        //     station, create-wishlist-item, scrobble) duplicate server-side if the
        //     write lands but the response is lost in transit;
        //   - a genuine 4xx just fails three more times;
        //   - mutations with optimistic updates (set-rating, create/delete-favorite,
        //     delete-playlist) hold the wrong UI state and defer their error toast for
        //     the whole backoff window, because onError only runs once retries are spent.
        // Re-enable per call site if one ever has a real reason to.
        retry: false,
    },
    queries: {
        gcTime: 1000 * 20, // 20 seconds
        refetchOnWindowFocus: false,
        // Was `retry: process.env.NODE_ENV === 'production'`, i.e. a bare `true` — which
        // in react-query v5 means *infinite* retries, not 3 (`shouldRetry = retry === true
        // || ...` short-circuits). Since a plain `vite build` always defines NODE_ENV as
        // 'production' regardless of the --mode used for env-file selection, every built
        // app retried every failed query forever on a 30s-capped backoff. The dev/prod
        // split itself is kept as-is: only `vite dev` takes the `false` branch, so a live
        // dev server still fails fast instead of masking errors behind retries.
        retry: process.env.NODE_ENV === 'production' ? 3 : false,
        staleTime: 1000 * 10, // 10 seconds
        throwOnError: (error: any) => {
            return error?.response?.status >= 500;
        },
    },
};

export const queryClient = new QueryClient({
    defaultOptions: queryConfig,
    queryCache,
});

export type InfiniteQueryHookArgs<T> = {
    options?: UseInfiniteQueryOptions;
    query: T;
    serverId: string | undefined;
};

export type MutationHookArgs = {
    options?: MutationOptions;
};

export type MutationOptions = {
    mutationKey: UseMutationOptions['mutationKey'];
    onError?: (err: any) => void;
    onSettled?: any;
    onSuccess?: any;
    retry?: UseQueryOptions['retry'];
    retryDelay?: UseQueryOptions['retryDelay'];
    useErrorBoundary?: boolean;
};

export type QueryHookArgs<T> = {
    options?: UseQueryHookOptions;
    query: T;
    serverId: string;
};

type UseQueryHookOptions = {
    enabled?: boolean;
    gcTime?: QueryOptions['gcTime'];
    // initialData?: UseQueryOptions['initialData'];
    // initialDataUpdatedAt?: UseQueryOptions['initialDataUpdatedAt'];
    meta?: UseQueryOptions['meta'];
    networkMode?: UseQueryOptions['networkMode'];
    notifyOnChangeProps?: UseQueryOptions['notifyOnChangeProps'];
    placeholderData?: (prev: any) => any;
    // queryFn?: UseQueryOptions['queryFn'];
    queryKey?: UseQueryOptions['queryKey'];
    queryKeyHashFn?: UseQueryOptions['queryKeyHashFn'];
    refetchInterval?: number;
    refetchIntervalInBackground?: UseQueryOptions['refetchIntervalInBackground'];
    refetchOnMount?: boolean;
    refetchOnReconnect?: boolean;
    refetchOnWindowFocus?: boolean;
    retry?: UseQueryOptions['retry'];
    retryDelay?: UseQueryOptions['retryDelay'];
    retryOnMount?: UseQueryOptions['retryOnMount'];
    // select?: UseQueryOptions['select'];
    staleTime?: number;
    structuralSharing?: UseQueryOptions['structuralSharing'];
    subscribed?: UseQueryOptions['subscribed'];
    throwOnError?: boolean;
};
