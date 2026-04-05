package sessions

import (
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

// deviceEventsRedis replaces the stub deviceEvents with Redis pub/sub fan-out.
// Mount calls this when a Redis client is available on the Handler.
func (h *Handler) deviceEventsRedis(w http.ResponseWriter, r *http.Request) {
	deviceID := chi.URLParam(r, "id")

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	fmt.Fprintf(w, "event: connected\ndata: {}\n\n")
	flusher.Flush()

	if h.rdb == nil {
		// No Redis — keep connection open, send keepalives only
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
				fmt.Fprintf(w, ": keepalive\n\n")
				flusher.Flush()
			}
		}
	}

	channel := fmt.Sprintf("silkie:device:%s:events", deviceID)
	sub := h.rdb.Client.Subscribe(r.Context(), channel)
	defer sub.Close()

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	msgCh := sub.Channel()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		case msg, ok := <-msgCh:
			if !ok {
				return
			}
			fmt.Fprintf(w, "event: session\ndata: %s\n\n", msg.Payload)
			flusher.Flush()
		}
	}
}
