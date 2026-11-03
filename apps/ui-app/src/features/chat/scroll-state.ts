export interface ScrollStream {
    active: boolean;
    conversationId?: string | null;
    assistantDomId?: string | null;
    progressId?: string | null;
}

/** A new conversation owns its POST stream before the server allocates an ID. */
export function streamBelongsToConversation(stream: ScrollStream | null | undefined, visibleId: string | null | undefined): boolean {
    if (!stream?.active) return false;
    const visible = (visibleId || '').trim();
    const streaming = (stream.conversationId || '').trim();
    return streaming ? streaming === visible : !visible;
}
