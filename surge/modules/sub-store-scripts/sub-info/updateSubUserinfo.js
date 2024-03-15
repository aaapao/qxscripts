// 这个是拉取订阅的时候 去写入流量信息
// 所以可能是下一次才会在客户端里看到新的流量信息

async function operator(proxies = [], targetPlatform, context) {
  const SUBS_KEY = 'subs'
  const $ = $substore
  const { source } = context

  if (source._collection) throw new Error('不支持组合订阅, 请在单条订阅中使用此脚本')

  // 获取流量信息
  // justmysocks 为例
  // justmysocks 套了 cf 可能风控了
  // 可尝试这样:
  // - 在浏览器里能打开一次 https://justmysocks5.net/members/getbwcounter.php?service=xxxx&id=xxxxxxxxxxxxxxxxxx
  // - 打开任何一个可以查你浏览器当前 User-Agent 的网站, 复制你的 User-Agent
  // - 编辑我脚本中的 User-Agent, 粘贴上你的 User-Agent
  // - 保存并重试
  const res = await $.http.get({
    url: 'https://justmysocks5.net/members/getbwcounter.php?service=xxxx&id=xxxxxxxxxxxxxxxxxx',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    },
  })
  let body = res.body
  try {
    body = JSON.parse(body)
  } catch (e) {
    console.log(e)
  }
  const upload = 0
  const download = body.bw_counter_b
  const total = body.monthly_bw_limit_b
  const expire = 0 // 可以没有到期时间

  const allSubs = $.read(SUBS_KEY) || []
  for (const name in source) {
    const sub = source[name]
    if (sub.name && (sub.url || sub.content)) {
      // 确定是订阅
      for (var index = 0; index < allSubs.length; index++) {
        if (sub.name === allSubs[index].name) {
          // 写入订阅流量信息
          allSubs[index].subUserinfo = `upload=${upload}; download=${download}; total=${total}${
            expire ? `; expire=${expire}` : ''
          }`
          break
        }
      }
      break
    }
  }
  $.write(allSubs, SUBS_KEY)

  return proxies
}
