import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslator } from '@/hooks/useTranslator';
import { getTranslators } from '@/services/translators';
import { localeToLang, isSameLang } from '@/utils/lang';
import { getLocale } from '@/utils/misc';

// 翻译缓存接口，用于避免重复翻译相同内容
interface TranslationCache {
  [key: string]: {
    text: string;
    timestamp: number;
  };
}

// 防抖函数
function debounce<T extends (text: string) => Promise<string>>(
  func: T,
  wait: number
): T {
  let timeout: NodeJS.Timeout;
  return ((text: string) => {
    clearTimeout(timeout);
    return new Promise<string>((resolve) => {
      timeout = setTimeout(() => {
        func(text).then(resolve);
      }, wait);
    });
  }) as T;
}

// 首页翻译功能hook
// 专门用于翻译书籍标题、作者名称等首页显示的文本内容
export const useLibraryTranslation = () => {
  const { token } = useAuth(); // 获取用户认证状态
  const { settings } = useSettingsStore(); // 获取全局设置
  
  // 从全局设置中获取翻译配置
  const globalViewSettings = settings.globalViewSettings;
  const globalReadSettings = settings.globalReadSettings;
  
  // 获取翻译启用状态
  const translationEnabled = globalViewSettings?.translationEnabled || false;

  // 翻译缓存，使用timestamp来实现过期机制
  const [translationCache, setTranslationCache] = useState<TranslationCache>({});
  
  // 缓存有效期 (30分钟)
  const CACHE_EXPIRY_MS = 30 * 60 * 1000;

  // 获取翻译配置参数
  const targetLanguage = globalViewSettings?.translateTargetLang || globalReadSettings?.translateTargetLang || '';
  const translationProvider = (globalViewSettings?.translationProvider || globalReadSettings?.translationProvider || 'deepl') as 'deepl' | 'azure' | 'google';

  // 初始化翻译器
  const { translate } = useTranslator({
    provider: translationProvider,
    sourceLang: 'AUTO', // 自动检测源语言
    targetLang: localeToLang(targetLanguage || getLocale()),
  });

  // 检查翻译服务是否可用
  const isTranslationAvailable = useMemo(() => {
    // 获取可用的翻译服务
    const availableTranslators = getTranslators().filter(
      (t) => (t.authRequired ? !!token : true) && !t.quotaExceeded
    );
    
    // 检查是否有可用的翻译服务
    if (availableTranslators.length === 0) {
      return false;
    }

    // 对于首页翻译，只要有翻译服务可用就允许翻译
    // 具体的语言匹配在translateText函数中动态判断
    return true;
  }, [token]);

  // 生成缓存键
  const generateCacheKey = useCallback((text: string): string => {
    return `${text}__${targetLanguage}__${translationProvider}`;
  }, [targetLanguage, translationProvider]);

  // 清理过期缓存
  const cleanExpiredCache = useCallback(() => {
    const now = Date.now();
    setTranslationCache(prev => {
      const newCache: TranslationCache = {};
      Object.entries(prev).forEach(([key, value]) => {
        if (now - value.timestamp < CACHE_EXPIRY_MS) {
          newCache[key] = value;
        }
      });
      return newCache;
    });
  }, []);

  // 从缓存中获取翻译
  const getCachedTranslation = useCallback((text: string): string | null => {
    const cacheKey = generateCacheKey(text);
    const cached = translationCache[cacheKey];
    
    if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY_MS) {
      return cached.text;
    }
    
    return null;
  }, [translationCache, generateCacheKey]);

  // 将翻译结果存入缓存
  const setCachedTranslation = useCallback((originalText: string, translatedText: string) => {
    const cacheKey = generateCacheKey(originalText);
    setTranslationCache(prev => ({
      ...prev,
      [cacheKey]: {
        text: translatedText,
        timestamp: Date.now(),
      },
    }));
  }, [generateCacheKey]);

  // 翻译文本的主要函数
  const translateText = useCallback(async (text: string): Promise<string> => {
    // 检查基本条件
    if (!text || !translationEnabled || !isTranslationAvailable) {
      return text;
    }

    // 检查文本长度和内容
    const trimmedText = text.trim();
    if (trimmedText.length < 2) {
      return text;
    }

    // 检查是否只包含数字和标点符号
    const isOnlyNumbersAndPunctuation = /^[\d\s.,!?;:'"()\-\[\]{}]+$/.test(trimmedText);
    if (isOnlyNumbersAndPunctuation) {
      return text;
    }

    // 首先检查缓存
    const cachedResult = getCachedTranslation(text);
    if (cachedResult) {
      return cachedResult;
    }

    try {
      // 调用翻译服务
      const translatedResult = await translate([text]);
      
      if (translatedResult && translatedResult.length > 0) {
        const translatedText = translatedResult[0];
        if (translatedText && translatedText !== text) {
          // 将翻译结果存入缓存
          setCachedTranslation(text, translatedText);
          return translatedText;
        }
      }
    } catch (error) {
      console.warn('Translation failed:', error);
      throw error;
    }

    // 如果翻译失败或结果与原文相同，返回原文
    return text;
  }, [
    translationEnabled, 
    isTranslationAvailable, 
    translate, 
    getCachedTranslation, 
    setCachedTranslation
  ]);

  // 创建防抖的翻译函数，避免频繁调用
  const debouncedTranslateText = useMemo(
    () => debounce(translateText, 300),
    [translateText]
  );

  // 定期清理过期缓存
  useEffect(() => {
    const interval = setInterval(cleanExpiredCache, 5 * 60 * 1000); // 每5分钟清理一次
    return () => clearInterval(interval);
  }, [cleanExpiredCache]);

  // 当翻译设置改变时清空缓存
  useEffect(() => {
    setTranslationCache({});
  }, [translationProvider, targetLanguage]);

  return {
    // 翻译状态
    translationEnabled,
    isTranslationAvailable,
    translationProvider,
    targetLanguage,
    
    // 翻译函数
    translateText,
    debouncedTranslateText,
    
    // 缓存管理
    getCachedTranslation,
    cleanExpiredCache,
    
    // 缓存统计信息
    cacheSize: Object.keys(translationCache).length,
  };
}; 