import React, { useEffect, useState, useMemo } from 'react';
import { RiTranslateAi } from 'react-icons/ri';
import { useLibraryTranslation } from '../hooks/useLibraryTranslation';
import { useTranslation } from '@/hooks/useTranslation';

interface TranslatableTextProps {
  // 原始文本内容
  text: string;
  // 自定义的CSS类名
  className?: string;
  // 文本标题，用于提示翻译状态
  title?: string;
  // 是否显示翻译来源标识
  showTranslationProvider?: boolean;
  // 最大重试次数
  maxRetries?: number;
}

// 可翻译文本组件
// 根据翻译设置自动显示原文或翻译后的文本
const TranslatableText: React.FC<TranslatableTextProps> = ({
  text,
  className,
  title,
  showTranslationProvider = false,
  maxRetries = 2,
}) => {
  const _ = useTranslation(); // 用于组件内文本的国际化
  const {
    translationEnabled,
    isTranslationAvailable,
    translateText,
    translationProvider,
    targetLanguage,
  } = useLibraryTranslation();

  // 存储翻译后的文本
  const [translatedText, setTranslatedText] = useState<string>(text);
  // 翻译加载状态
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  // 是否已完成翻译
  const [isTranslated, setIsTranslated] = useState<boolean>(false);
  // 翻译错误状态
  const [translationError, setTranslationError] = useState<string | null>(null);
  // 重试次数计数器
  const [retryCount, setRetryCount] = useState<number>(0);

  // 检查文本是否需要翻译
  const shouldTranslate = useMemo(() => {
    // 空文本或过短的文本不需要翻译
    if (!text || text.trim().length < 2) {
      return false;
    }
    
    // 只包含数字、标点符号的文本不需要翻译
    const isOnlyNumbersAndPunctuation = /^[\d\s.,!?;:'"()\-\[\]{}]+$/.test(text.trim());
    if (isOnlyNumbersAndPunctuation) {
      return false;
    }

    // 基本的翻译条件检查
    if (!translationEnabled || !isTranslationAvailable) {
      return false;
    }

    // 简单的语言检测：如果文本看起来像目标语言，就不翻译
    if (targetLanguage) {
      // 如果目标语言是中文，检查文本是否包含中文字符
      if (targetLanguage.includes('zh') && /[\u4e00-\u9fff]/.test(text)) {
        return false;
      }
      // 如果目标语言是英文，检查文本是否主要是英文
      if (targetLanguage === 'en' && /^[a-zA-Z\s.,!?;:'"()\-\[\]{}0-9]+$/.test(text.trim())) {
        return false;
      }
    }

    return true;
  }, [text, translationEnabled, isTranslationAvailable, targetLanguage]);

  // 执行翻译
  const performTranslation = async () => {
    if (!shouldTranslate || isTranslating) {
      return;
    }

    setIsTranslating(true);
    setTranslationError(null);

    try {
      const result = await translateText(text);
      
      if (result && result !== text) {
        setTranslatedText(result);
        setIsTranslated(true);
        setRetryCount(0); // 重置重试计数
      } else {
        // 翻译失败或结果与原文相同
        setTranslatedText(text);
        setIsTranslated(false);
      }
    } catch (error) {
      console.warn('Translation failed:', error);
      setTranslationError(_('Translation failed'));
      
      // 如果还有重试次数，则进行重试
      if (retryCount < maxRetries) {
        setRetryCount(prev => prev + 1);
        // 延迟重试，避免频繁请求
        setTimeout(() => {
          performTranslation();
        }, 1000 * (retryCount + 1)); // 递增延迟时间
      } else {
        // 重试次数耗尽，显示原文
        setTranslatedText(text);
        setIsTranslated(false);
      }
    } finally {
      setIsTranslating(false);
    }
  };

  // 监听翻译状态变化
  useEffect(() => {
    if (shouldTranslate) {
      // 如果当前显示的是原文，需要进行翻译
      if (!isTranslated || translatedText === text) {
        performTranslation();
      }
    } else {
      // 如果翻译被禁用，显示原文
      if (translatedText !== text) {
        setTranslatedText(text);
        setIsTranslated(false);
        setTranslationError(null);
        setRetryCount(0);
      }
    }
  }, [shouldTranslate, text]);

  // 监听文本变化，重置状态
  useEffect(() => {
    setTranslatedText(text);
    setIsTranslated(false);
    setTranslationError(null);
    setRetryCount(0);
  }, [text]);

  // 生成显示的内容
  const displayText = shouldTranslate ? translatedText : text;
  
  // 生成工具提示文本
  const tooltipText = useMemo(() => {
    if (isTranslating) {
      return retryCount > 0 
        ? _('Retrying translation...') + ` (${retryCount}/${maxRetries})`
        : _('Translating...');
    }
    
    if (translationError) {
      return retryCount >= maxRetries 
        ? _('Translation failed. Showing original text.')
        : translationError;
    }
    
    if (shouldTranslate && isTranslated) {
      return _('Translated by {{provider}}.').replace('{{provider}}', translationProvider || 'Unknown');
    }
    
    return title;
  }, [isTranslating, translationError, shouldTranslate, isTranslated, translationProvider, title, retryCount, maxRetries, _]);

  return (
    <span 
      className={className}
      title={tooltipText}
    >
      {displayText}
      
      {/* 翻译状态指示器 */}
      {(isTranslating || (showTranslationProvider && shouldTranslate && isTranslated)) && (
        <span className="ml-1 inline-flex items-center">
          {isTranslating ? (
            // 翻译中的旋转动画
            <RiTranslateAi 
              className={`h-3 w-3 ${
                retryCount > 0 
                  ? 'text-yellow-500 animate-pulse' 
                  : 'text-blue-500 animate-spin'
              }`}
              title={tooltipText}
            />
          ) : (
            // 翻译完成后的提供商标识
            showTranslationProvider && isTranslated && (
              <span 
                className="text-xs text-neutral-content/60 font-normal"
                title={tooltipText}
              >
                {translationProvider}
              </span>
            )
          )}
        </span>
      )}
      
      {/* 翻译错误指示器 */}
      {translationError && retryCount >= maxRetries && (
        <span 
          className="ml-1 text-red-500 text-xs cursor-help"
          title={_('Translation failed. Click to retry.')}
          onClick={(e) => {
            e.stopPropagation();
            setRetryCount(0);
            setTranslationError(null);
            performTranslation();
          }}
        >
          ⚠
        </span>
      )}
    </span>
  );
};

export default TranslatableText; 