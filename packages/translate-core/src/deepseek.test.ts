import { describe, it, expect, vi, afterEach } from 'vitest'
import { callDeepSeek } from './deepseek'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('callDeepSeek', () => {
  it('rejects empty text', async () => {
    await expect(
      callDeepSeek(
        { baseUrl: 'https://api.deepseek.com', apiKey: 'sk', model: 'deepseek-v4-flash' },
        { text: '  ', mode: 'translate' }
      )
    ).rejects.toThrow('请输入要翻译的文字')
  })

  it('rejects missing api key', async () => {
    await expect(
      callDeepSeek(
        { baseUrl: 'https://api.deepseek.com', apiKey: '  ', model: 'deepseek-v4-flash' },
        { text: 'hello', mode: 'translate' }
      )
    ).rejects.toThrow('请先在设置中填写 API Key')
  })

  it('posts chat completions and returns content', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '你好' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const out = await callDeepSeek(
      { baseUrl: 'https://api.deepseek.com/', apiKey: 'sk-test', model: 'deepseek-v4-flash' },
      { text: 'hello', mode: 'translate', targetLang: 'zh' }
    )
    expect(out).toBe('你好')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
