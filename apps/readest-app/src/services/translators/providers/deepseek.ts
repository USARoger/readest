import { stubTranslation as _ } from '@/utils/misc';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { TranslationProvider } from '../types';

// DeepSeek API配置常量
// 根据DeepSeek API文档配置基础URL和模型名称
const DEEPSEEK_API_KEY = 'sk-59a7833c2c3d428a8ca9145a6ce1f02e';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const DEEPSEEK_MODEL = 'deepseek-chat'; // 使用DeepSeek-V3-0324模型

// 语言映射表：将常用语言代码映射到DeepSeek能理解的格式
// DeepSeek使用自然语言描述而非语言代码
const LANGUAGE_MAP: Record<string, string> = {
  // 自动检测
  'AUTO': 'auto-detect',
  'auto': 'auto-detect',
  
  // 中文
  'zh': 'Chinese',
  'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
  'zh-HK': 'Chinese (Traditional)',
  
  // 英文
  'en': 'English',
  'EN': 'English',
  
  // 其他常用语言
  'ja': 'Japanese',
  'ko': 'Korean',
  'fr': 'French',
  'de': 'German',
  'es': 'Spanish',
  'it': 'Italian',
  'pt': 'Portuguese',
  'ru': 'Russian',
  'ar': 'Arabic',
  'hi': 'Hindi',
  'th': 'Thai',
  'vi': 'Vietnamese',
};

// 获取语言的自然语言描述
// 如果语言代码不在映射表中，则直接使用原始代码
const getLanguageName = (langCode: string): string => {
  return LANGUAGE_MAP[langCode] || langCode;
};

// 构建翻译提示词
// 使用专业的翻译提示，确保翻译质量和一致性
const buildTranslationPrompt = (texts: string[], sourceLang: string, targetLang: string): string => {
  const sourceLanguage = getLanguageName(sourceLang);
  const targetLanguage = getLanguageName(targetLang);
  
  // 如果是自动检测源语言，使用更灵活的提示
  const languageInstruction = sourceLang === 'AUTO' || sourceLang === 'auto' 
    ? `Detect the source language automatically and translate to ${targetLanguage}`
    : `Translate from ${sourceLanguage} to ${targetLanguage}`;

  // 专业翻译提示词，确保高质量翻译
  const prompt = `You are a professional translator. ${languageInstruction}.

Rules:
1. Maintain the original meaning and context
2. Keep the same tone and style
3. Preserve formatting (line breaks, punctuation)
4. For proper nouns, keep original if no standard translation exists
5. Return only the translated text, no explanations
6. If multiple texts are provided, translate each one separately and return in the same order

Texts to translate:
${texts.map((text, index) => `${index + 1}. ${text}`).join('\n')}`;

  return prompt;
};

// 解析DeepSeek API响应
// 从AI回复中提取翻译结果，处理可能的格式变化
const parseTranslationResponse = (content: string, originalTexts: string[]): string[] => {
  if (!content) return originalTexts;

  // 尝试按行分割（如果AI返回了编号格式）
  const lines = content.split('\n').filter(line => line.trim());
  
  // 如果只有一个文本要翻译，直接返回内容
  if (originalTexts.length === 1) {
    // 移除可能的编号前缀 "1. "
    const cleanContent = content.replace(/^\d+\.\s*/, '').trim();
    return [cleanContent || originalTexts[0]];
  }

  // 多个文本的情况，尝试匹配编号格式
  const results: string[] = [];
  let currentIndex = 0;

  for (const line of lines) {
    // 匹配编号格式：1. 翻译内容
    const match = line.match(/^\d+\.\s*(.+)$/);
    if (match && match[1] && currentIndex < originalTexts.length) {
      results.push(match[1].trim());
      currentIndex++;
    }
  }

  // 如果解析的结果数量不匹配，使用备用策略
  if (results.length !== originalTexts.length) {
    // 简单按行分割，取前N行
    const fallbackLines = content.split('\n')
      .filter(line => line.trim())
      .map(line => line.replace(/^\d+\.\s*/, '').trim())
      .filter(line => line.length > 0);
    
    // 确保结果数量匹配
    while (fallbackLines.length < originalTexts.length) {
      const targetIndex = fallbackLines.length;
      const fallbackText = originalTexts[targetIndex] || '';
      fallbackLines.push(fallbackText);
    }
    
    return fallbackLines.slice(0, originalTexts.length);
  }

  return results;
};

// DeepSeek翻译提供者实现
// 实现TranslationProvider接口，提供完整的翻译功能
export const deepseekProvider: TranslationProvider = {
  name: 'deepseek',  // 提供者名称，用于在系统中识别
  label: _('DeepSeek'),  // 显示名称，支持国际化
  authRequired: false,   // DeepSeek不需要用户登录，使用固定API密钥
  quotaExceeded: false,  // 初始状态未超出配额
  
  // 翻译函数实现
  // 接收文本数组、源语言、目标语言等参数，返回翻译结果
  translate: async (
    texts: string[],        // 要翻译的文本数组
    sourceLang: string,     // 源语言代码
    targetLang: string,     // 目标语言代码
    token?: string | null,  // 用户令牌（DeepSeek不需要）
    useCache?: boolean,     // 是否使用缓存（由上层处理）
  ): Promise<string[]> => {
    // 空数组直接返回
    if (!texts.length) return [];

    // 过滤空文本，但保留索引位置
    const results: string[] = new Array(texts.length);
    const textsToTranslate: { text: string; index: number }[] = [];

    // 预处理：找出需要翻译的文本
    texts.forEach((text, index) => {
      if (!text?.trim().length) {
        results[index] = text; // 空文本直接返回
      } else {
        textsToTranslate.push({ text: text.trim(), index });
      }
    });

    // 如果没有需要翻译的文本，直接返回
    if (textsToTranslate.length === 0) {
      return results;
    }

    try {
      // 构建翻译提示词
      const prompt = buildTranslationPrompt(
        textsToTranslate.map(item => item.text),
        sourceLang,
        targetLang
      );

      // 准备DeepSeek API请求
      const requestBody = {
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a professional translator. Provide accurate and natural translations while preserving the original meaning and style.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        stream: false,        // 不使用流式响应
        temperature: 0.1,     // 低温度确保翻译一致性
        max_tokens: 4000,     // 最大输出令牌数
      };

      // 选择合适的fetch函数（Tauri环境 vs 浏览器环境）
      const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
      
      // 发送API请求
      const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
      });

      // 检查响应状态
      if (!response.ok) {
        let errorMessage = `Translation failed with status ${response.status}`;
        
        try {
          const errorData = await response.json();
          if (errorData.error && errorData.error.message) {
            errorMessage = `DeepSeek API Error: ${errorData.error.message}`;
          }
        } catch {
          // 忽略JSON解析错误，使用默认错误消息
        }
        
        throw new Error(errorMessage);
      }

      // 解析响应数据
      const data = await response.json();
      
      if (!data.choices || !data.choices.length || !data.choices[0].message) {
        throw new Error('Invalid response format from DeepSeek API');
      }

      const translatedContent = data.choices[0].message.content;
      if (!translatedContent) {
        throw new Error('No translation content received from DeepSeek API');
      }

      // 解析翻译结果
      const translations = parseTranslationResponse(
        translatedContent,
        textsToTranslate.map(item => item.text)
      );

      // 将翻译结果放回原始位置
      textsToTranslate.forEach((item, translationIndex) => {
        const translatedText = translations[translationIndex];
        results[item.index] = translatedText !== undefined ? translatedText : item.text;
      });

      return results;

    } catch (error) {
      // 错误处理：记录错误并重新抛出
      console.error('DeepSeek translation error:', error);
      
      // 如果是网络错误或API错误，抛出原始错误
      if (error instanceof Error) {
        throw error;
      }
      
      // 未知错误类型，包装为Error对象
      throw new Error(`DeepSeek translation failed: ${String(error)}`);
    }
  },
}; 