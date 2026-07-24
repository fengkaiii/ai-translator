export type TranslateMode = 'translate' | 'polish'

/** 强制目标语言；不传则自动判定 */
export type TargetLang = 'zh' | 'en'

export type TranslateRequest = {
  text: string
  mode: TranslateMode
  previousTranslation?: string
  targetLang?: TargetLang
}
