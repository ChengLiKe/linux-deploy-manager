import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, RefreshCw, ExternalLink, Globe, Home, ChevronUp, ChevronDown, X, AlertCircle } from 'lucide-react'

export default function InlineBrowser() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const initialUrl = searchParams.get('url') || ''
  const urlName = searchParams.get('name') || '网页'

  // URL 历史栈（独立于 React Router）
  const [urlHistory, setUrlHistory] = useState<string[]>(() =>
    initialUrl ? [initialUrl] : []
  )
  const [historyIndex, setHistoryIndex] = useState(() => (initialUrl ? 0 : -1))
  const [currentUrl, setCurrentUrl] = useState(initialUrl)
  const [inputValue, setInputValue] = useState(initialUrl)
  const [iframeKey, setIframeKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const loadingTimer = useRef<ReturnType<typeof setTimeout>>()

  const canGoBack = historyIndex > 0
  const canGoForward = historyIndex < urlHistory.length - 1

  const navigateTo = useCallback((targetUrl: string) => {
    if (!targetUrl) return
    let normalized = targetUrl.trim()
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = 'https://' + normalized
    }

    // 更新历史栈
    setUrlHistory((prev) => [...prev.slice(0, historyIndex + 1), normalized])
    setHistoryIndex((prev) => prev + 1)
    setCurrentUrl(normalized)
    setInputValue(normalized)
    setLoading(true)
    setError('')
    setIframeKey((prev) => prev + 1)

    // 20 秒超时
    if (loadingTimer.current) clearTimeout(loadingTimer.current)
    loadingTimer.current = setTimeout(() => {
      setLoading(false)
      setError('页面加载超时，请检查网络或尝试在外部浏览器打开')
    }, 20000)
  }, [historyIndex])

  const goBack = () => {
    if (!canGoBack) return
    const newIndex = historyIndex - 1
    setHistoryIndex(newIndex)
    const url = urlHistory[newIndex]
    setCurrentUrl(url)
    setInputValue(url)
    setLoading(true)
    setIframeKey((prev) => prev + 1)
  }

  const goForward = () => {
    if (!canGoForward) return
    const newIndex = historyIndex + 1
    setHistoryIndex(newIndex)
    const url = urlHistory[newIndex]
    setCurrentUrl(url)
    setInputValue(url)
    setLoading(true)
    setIframeKey((prev) => prev + 1)
  }

  const handleRefresh = () => {
    setIframeKey((prev) => prev + 1)
    setLoading(true)
    setError('')
  }

  const handleGo = () => navigateTo(inputValue)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleGo()
  }

  const handleOpenExternal = () => {
    window.open(currentUrl, '_blank')
  }

  const handleBackToList = () => {
    navigate('/server-nodes')
  }

  const handleIframeLoad = () => {
    setLoading(false)
    setError('')
    if (loadingTimer.current) clearTimeout(loadingTimer.current)
  }

  // 初始化
  useEffect(() => {
    if (initialUrl) {
      setIframeKey(1)
    }
    return () => {
      if (loadingTimer.current) clearTimeout(loadingTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-white">
      {/* 浏览器工具栏 */}
      <div className={`shrink-0 bg-white border-b border-slate-200 shadow-sm transition-all duration-200 ${
        toolbarCollapsed ? '' : ''
      }`}>
        <div className="flex items-center gap-2 px-4 py-2">
          <button
            onClick={handleBackToList}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            title="返回服务器列表"
          >
            <Home size={18} />
          </button>
          <div className="w-px h-5 bg-slate-200" />
          <button
            onClick={goBack}
            disabled={!canGoBack}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
            title="后退"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            onClick={goForward}
            disabled={!canGoForward}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
            title="前进"
          >
            <ArrowRight size={16} />
          </button>
          <button
            onClick={handleRefresh}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            title="刷新"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <div className="flex-1 flex items-center gap-2">
            <Globe size={14} className="text-slate-400 shrink-0" />
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 focus:bg-white transition-colors"
              placeholder="输入网址并按回车访问..."
            />
            <button
              onClick={handleGo}
              className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
            >
              访问
            </button>
          </div>
          <button
            onClick={handleOpenExternal}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            title="在外部浏览器打开"
          >
            <ExternalLink size={14} />
            外部
          </button>
          <span className="text-xs text-slate-400 px-2 truncate max-w-[120px]" title={urlName}>
            {urlName}
          </span>
          {/* 折叠按钮 */}
          <button
            onClick={() => setToolbarCollapsed(!toolbarCollapsed)}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            title={toolbarCollapsed ? '展开工具栏' : '折叠工具栏'}
          >
            {toolbarCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
        {error && (
          <div className="px-4 py-1.5 text-xs text-red-600 bg-red-50 border-t border-red-100">
            {error}
          </div>
        )}
      </div>

      {/* iframe 容器 — 用 calc 扣除工具栏高度 */}
      <div className="flex-1 relative overflow-hidden">
        {currentUrl ? (
          <>
            <iframe
              key={iframeKey}
              src={currentUrl}
              className="absolute inset-0 w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              onLoad={handleIframeLoad}
              onError={() => {
                setLoading(false)
                setError('页面加载失败，请检查网址是否正确')
              }}
              title="内嵌浏览器"
            />
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-2 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
                  <span className="text-xs text-slate-400">加载中...</span>
                </div>
              </div>
            )}
            {!bannerDismissed && (
              <div className="absolute bottom-4 left-4 right-4 flex justify-center">
                <div className="bg-slate-800/90 text-white text-[11px] px-4 py-2 rounded-full flex items-center gap-2 shadow-lg backdrop-blur-sm max-w-[600px]">
                  <AlertCircle size={12} className="text-amber-400 shrink-0" />
                  <span>部分网站可能因安全策略限制无法加载</span>
                  <button
                    onClick={() => window.open(currentUrl, '_blank')}
                    className="text-amber-400 hover:text-amber-300 underline underline-offset-2 shrink-0 whitespace-nowrap"
                  >
                    外部打开
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setBannerDismissed(true) }}
                    className="p-0.5 text-slate-500 hover:text-white rounded-full shrink-0 ml-1"
                    title="关闭"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Globe className="mx-auto mb-3 text-slate-200" size={64} />
              <p className="text-sm text-slate-400">请在地址栏输入网址后访问</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
