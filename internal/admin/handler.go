package admin

import (
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
)

type Handler struct{}

func New() *Handler {
	return &Handler{}
}

func (h *Handler) Mount(r chi.Router) {
	r.Get("/admin", h.serveAdmin)
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/admin", http.StatusFound)
	})
	r.Get("/login", h.serveLogin)
}

func (h *Handler) serveAdmin(w http.ResponseWriter, r *http.Request) {
	serveHTMLFile(w, "docs/template/admin.html")
}

func (h *Handler) serveLogin(w http.ResponseWriter, r *http.Request) {
	serveHTMLFile(w, "docs/template/login.html")
}

func serveHTMLFile(w http.ResponseWriter, path string) {
	body, err := os.ReadFile(path)
	if err != nil {
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(body)
}
