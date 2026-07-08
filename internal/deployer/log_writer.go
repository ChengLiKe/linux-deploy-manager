package deployer

import "io"

// logWriter 将 io.Writer 输出适配到 LogBuffer
type logWriter struct {
	buf    *LogBuffer
	prefix string
}

func newLogWriter(buf *LogBuffer, prefix string) io.Writer {
	return &logWriter{buf: buf, prefix: prefix}
}

func (w *logWriter) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	// 去除末尾换行，由 LogBuffer 自行处理格式
	content := string(p)
	for len(content) > 0 && (content[len(content)-1] == '\n' || content[len(content)-1] == '\r') {
		content = content[:len(content)-1]
	}
	if content != "" {
		w.buf.Writef("%s%s", w.prefix, content)
	}
	return len(p), nil
}
