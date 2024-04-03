/**
 * 节点信息(适配 Surge/Loon 版 也可在任意平台上使用 HTTP API)
 *
 * 查看说明: https://t.me/zhetengsha/1269
 *
 * 欢迎加入 Telegram 群组 https://t.me/zhetengsha
 *
 * 参数
 * - [retries] 重试次数 默认 1
 * - [retry_delay] 重试延时(单位: 毫秒) 默认 1000
 * - [concurrency] 并发数 默认 10
 * - [timeout] 请求超时(单位: 毫秒) 默认 5000
 * - [method] 请求方法. 默认 get
 * - [api] 测落地的 API 接口. 默认为 http://ip-api.com/json?lang=zh-CN
 * - [format] 自定义格式, 从 节点(proxy) 和 API 接口响应(api) 中取数据. 默认为: {{api.country}} {{api.isp}} - {{proxy.name}}
 * - [cache] 使用缓存, 默认不使用缓存
 * - [geo] 在节点上附加 _geo 字段, 默认不附加
 * - [incompatible] 在节点上附加 _incompatible 字段来标记当前客户端不兼容该协议, 默认不附加
 * - [remove_incompatible] 移除当前客户端不兼容的协议. 默认不移除.
 * - [remove_failed] 移除失败的节点. 默认不移除.
 * - [surge_http_api] 使用另一台设备上的 HTTP API. 设置后, 将不检测当前运行客户端, 并使用另一台设备上的 HTTP API 执行请求. 默认不使用. 例: 192.168.31.5:6171
 * - [surge_http_api_protocol] HTTP API 的 协议. 默认 http
 * - [surge_http_api_key] HTTP API 的 密码
 */

async function operator(proxies = [], targetPlatform, context) {
  const $ = $substore
  const { isLoon, isSurge } = $.env
  const surge_http_api = $arguments.surge_http_api
  const surge_http_api_protocol = $arguments.surge_http_api_protocol || 'http'
  const surge_http_api_key = $arguments.surge_http_api_key
  const surge_http_api_enabled = surge_http_api
  if (!surge_http_api_enabled && !isLoon && !isSurge)
    throw new Error('仅支持 Loon 和 Surge(ability=http-client-policy) 或 配置 HTTP API')
  const remove_failed = $arguments.remove_failed
  const remove_incompatible = $arguments.remove_incompatible
  const incompatibleEnabled = $arguments.incompatible
  const geoEnabled = $arguments.geo
  const cacheEnabled = $arguments.cache
  const cache = scriptResourceCache
  const format = $arguments.format || '{{api.country}} {{api.isp}} - {{proxy.name}}'
  const method = $arguments.method || 'get'
  const url = $arguments.api || 'http://ip-api.com/json?lang=zh-CN'
  const target = isLoon ? 'Loon' : isSurge ? 'Surge' : undefined
  const batches = []
  const concurrency = parseInt($arguments.concurrency || 10) // 一组并发数
  for (let i = 0; i < proxies.length; i += concurrency) {
    const batch = proxies.slice(i, i + concurrency)
    batches.push(batch)
  }

  for (const batch of batches) {
    await Promise.all(batch.map(check))
  }

  if (remove_incompatible || remove_failed) {
    proxies = proxies.filter(p => {
      if (remove_incompatible && p._incompatible) {
        return false
      } else if (remove_failed && !p._geo) {
        return !remove_incompatible && p._incompatible
      }
      return true
    })
  }

  if (!geoEnabled || !incompatibleEnabled) {
    proxies = proxies.map(p => {
      if (!geoEnabled) {
        delete p._geo
      }
      if (!incompatibleEnabled) {
        delete p._incompatible
      }
      return p
    })
  }

  return proxies

  async function check(proxy) {
    // $.info(`[${proxy.name}] 检测`)
    // $.info(`检测 ${JSON.stringify(proxy, null, 2)}`)
    const id = cacheEnabled
      ? `geo:${url}:${format}:${JSON.stringify(
          Object.fromEntries(Object.entries(proxy).filter(([key]) => !/^(collectionName|subName|id|_.*)$/i.test(key)))
        )}`
      : undefined
    // $.info(`检测 ${id}`)
    try {
      const node = ProxyUtils.produce([proxy], surge_http_api_enabled ? 'Surge' : target)
      if (node) {
        const cached = cache.get(id)
        if (cacheEnabled && cached) {
          $.info(`[${proxy.name}] 使用缓存`)
          if (cached.api) {
            $.log(`[${proxy.name}] api: ${JSON.stringify(cached.api, null, 2)}`)
            proxy.name = formatter({ proxy, api: cached.api, format })
            proxy._geo = cached.api
          }
          return
        }
        // 请求
        const startedAt = Date.now()
        const res = await http({
          method,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1',
          },
          url,
          'policy-descriptor': node,
          node,
        })
        let api = String(lodash_get(res, 'body'))
        try {
          api = JSON.parse(api)
        } catch (e) {}
        const status = parseInt(res.status || res.statusCode || 200)
        let latency = ''
        latency = `${Date.now() - startedAt}`
        $.info(`[${proxy.name}] status: ${status}, latency: ${latency}`)
        $.log(`[${proxy.name}] api: ${JSON.stringify(api, null, 2)}`)
        if (status == 200) {
          proxy.name = formatter({ proxy, api, format })
          proxy._geo = api
          if (cacheEnabled) {
            $.info(`[${proxy.name}] 设置成功缓存`)
            cache.set(id, { api })
          }
        } else {
          if (cacheEnabled) {
            $.info(`[${proxy.name}] 设置失败缓存`)
            cache.set(id, {})
          }
        }
      } else {
        proxy._incompatible = true
      }
    } catch (e) {
      $.error(`[${proxy.name}] ${e.message ?? e}`)
      if (cacheEnabled) {
        $.info(`[${proxy.name}] 设置失败缓存`)
        cache.set(id, {})
      }
    }
  }
  // 请求
  async function http(opt = {}) {
    const METHOD = opt.method || 'get'
    const TIMEOUT = parseFloat(opt.timeout || $arguments.timeout || 5000)
    const RETRIES = parseFloat(opt.retries ?? $arguments.retries ?? 1)
    const RETRY_DELAY = parseFloat(opt.retry_delay ?? $arguments.retry_delay ?? 1000)

    let count = 0
    const fn = async () => {
      try {
        if (surge_http_api_enabled) {
          const res = await $.http.post({
            url: `${surge_http_api_protocol}://${surge_http_api}/v1/scripting/evaluate`,
            timeout: TIMEOUT,
            headers: { 'x-key': surge_http_api_key, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              script_text: `$httpClient.get(${JSON.stringify({
                ...opt,
                timeout: TIMEOUT / 1000,
              })}, (error, response, data) => {  $done({ error, response, data }) }) `,
              mock_type: 'cron',
              timeout: TIMEOUT / 1000,
            }),
          })
          let body = String(lodash_get(res, 'body'))
          try {
            body = JSON.parse(body)
          } catch (e) {}
          // $.info(JSON.stringify(body, null, 2))
          const error = lodash_get(body, 'result.error')
          if (error) throw new Error(error)
          let data = String(lodash_get(body, 'result.data'))
          let response = String(lodash_get(body, 'result.response'))
          // try {
          //   data = JSON.parse(data)
          // } catch (e) {}
          // $.info(JSON.stringify(data, null, 2))
          return { ...response, body: data }
        } else {
          return await $.http[METHOD]({ ...opt, timeout: TIMEOUT })
        }
      } catch (e) {
        // $.error(e)
        if (count < RETRIES) {
          count++
          const delay = RETRY_DELAY * count
          // $.info(`第 ${count} 次请求失败: ${e.message || e}, 等待 ${delay / 1000}s 后重试`)
          await $.wait(delay)
          return await fn()
        } else {
          throw e
        }
      }
    }
    return await fn()
  }
  function lodash_get(source, path, defaultValue = undefined) {
    const paths = path.replace(/\[(\d+)\]/g, '.$1').split('.')
    let result = source
    for (const p of paths) {
      result = Object(result)[p]
      if (result === undefined) {
        return defaultValue
      }
    }
    return result
  }
  function formatter({ proxy = {}, api = {}, format = '' }) {
    let f = format.replace(/\{\{(.*?)\}\}/g, '${$1}')
    return eval(`\`${f}\``)
  }
}
