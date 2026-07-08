package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/linux-deploy-manager/internal/auth"
)

// Recovery 捕获 panic 的中间件
func Recovery() gin.HandlerFunc {
	return gin.Recovery()
}

// Logger 请求日志中间件
func Logger() gin.HandlerFunc {
	return gin.Logger()
}

// CORS 跨域中间件
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// JWTAuth JWT 认证中间件
func JWTAuth(authService *auth.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.GetHeader("Authorization")
		if len(token) > 7 && token[:7] == "Bearer " {
			token = token[7:]
		}

		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"code": 401001, "message": "缺少认证信息"})
			c.Abort()
			return
		}

		t, err := authService.ValidateToken(token)
		if err != nil || !t.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"code": 401002, "message": "认证已失效，请重新登录"})
			c.Abort()
			return
		}

		c.Next()
	}
}

// ServeEmbed 嵌入静态文件服务（fs 已定位到前端产物根目录）
func ServeEmbed(fs http.FileSystem) gin.HandlerFunc {
	fileServer := http.FileServer(fs)
	return func(c *gin.Context) {
		path := c.Request.URL.Path

		// 尝试打开文件
		f, err := fs.Open(path)
		if err != nil {
			// 回退到 index.html（SPA 路由）
			c.Request.URL.Path = "/index.html"
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}
		f.Close()

		c.Request.URL.Path = path
		fileServer.ServeHTTP(c.Writer, c.Request)
	}
}
