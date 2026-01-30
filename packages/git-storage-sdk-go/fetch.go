package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type apiFetcher struct {
	baseURL    string
	version    int
	httpClient *http.Client
}

func newAPIFetcher(baseURL string, version int, client *http.Client) *apiFetcher {
	if client == nil {
		client = http.DefaultClient
	}
	return &apiFetcher{baseURL: strings.TrimRight(baseURL, "/"), version: version, httpClient: client}
}

func (f *apiFetcher) basePath() string {
	return f.baseURL + "/api/v" + itoa(f.version)
}

func (f *apiFetcher) buildURL(path string, params url.Values) string {
	if params == nil || len(params) == 0 {
		return f.basePath() + "/" + path
	}
	return f.basePath() + "/" + path + "?" + params.Encode()
}

type requestOptions struct {
	allowedStatus map[int]bool
}

func (f *apiFetcher) request(ctx context.Context, method string, path string, params url.Values, body interface{}, jwt string, opts *requestOptions) (*http.Response, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	urlStr := f.buildURL(path, params)
	var bodyReader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(payload)
	}

	req, err := http.NewRequestWithContext(ctx, method, urlStr, bodyReader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+jwt)
	req.Header.Set("Code-Storage-Agent", userAgent())
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := f.httpClient.Do(req)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if opts != nil && opts.allowedStatus != nil && opts.allowedStatus[resp.StatusCode] {
			return resp, nil
		}

		defer resp.Body.Close()
		bodyBytes, _ := io.ReadAll(resp.Body)
		var parsed interface{}
		message := ""
		contentType := resp.Header.Get("content-type")
		if strings.Contains(contentType, "application/json") {
			var payload map[string]interface{}
			if err := json.Unmarshal(bodyBytes, &payload); err == nil {
				parsed = payload
				if errVal, ok := payload["error"].(string); ok && strings.TrimSpace(errVal) != "" {
					message = strings.TrimSpace(errVal)
				}
			}
		}
		if message == "" && len(bodyBytes) > 0 {
			message = strings.TrimSpace(string(bodyBytes))
			if message != "" {
				parsed = message
			}
		}

		if message == "" {
			message = "request " + method + " " + urlStr + " failed with status " + itoa(resp.StatusCode) + " " + resp.Status
		}

		return nil, &APIError{
			Message:    message,
			Status:     resp.StatusCode,
			StatusText: resp.Status,
			Method:     method,
			URL:        urlStr,
			Body:       parsed,
		}
	}

	return resp, nil
}

func (f *apiFetcher) get(ctx context.Context, path string, params url.Values, jwt string, opts *requestOptions) (*http.Response, error) {
	return f.request(ctx, http.MethodGet, path, params, nil, jwt, opts)
}

func (f *apiFetcher) post(ctx context.Context, path string, params url.Values, body interface{}, jwt string, opts *requestOptions) (*http.Response, error) {
	return f.request(ctx, http.MethodPost, path, params, body, jwt, opts)
}

func (f *apiFetcher) put(ctx context.Context, path string, params url.Values, body interface{}, jwt string, opts *requestOptions) (*http.Response, error) {
	return f.request(ctx, http.MethodPut, path, params, body, jwt, opts)
}

func (f *apiFetcher) delete(ctx context.Context, path string, params url.Values, body interface{}, jwt string, opts *requestOptions) (*http.Response, error) {
	return f.request(ctx, http.MethodDelete, path, params, body, jwt, opts)
}
