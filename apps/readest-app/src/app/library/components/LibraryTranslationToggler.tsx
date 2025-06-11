import React, { useEffect, useState } from 'react';
import { RiTranslateAi } from 'react-icons/ri';

import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { isSameLang } from '@/utils/lang';
import { getLocale } from '@/utils/misc';
import { getTranslators } from '@/services/translators';
import Button from '@/components/Button';

// 首页翻译切换组件
// 专门用于控制首页内容（如书籍标题）的翻译功能
const LibraryTranslationToggler: React.FC = () => {
  const _ = useTranslation(); // 用于组件内文本的国际化
  const { envConfig } = useEnv(); // 获取环境配置
  const { token } = useAuth(); // 获取用户认证状态
  const { settings, setSettings, saveSettings } = useSettingsStore(); // 全局设置管理

  // 从全局设置中获取翻译相关配置
  const globalReadSettings = settings.globalReadSettings;
  const globalViewSettings = settings.globalViewSettings;
  
  // 翻译启用状态，使用全局视图设置中的翻译配置
  const [translationEnabled, setTranslationEnabled] = useState(
    globalViewSettings?.translationEnabled || false
  );

  // 保存操作状态，用于显示加载指示器
  const [isSaving, setIsSaving] = useState(false);

  // 获取当前翻译目标语言
  const targetLanguage = globalViewSettings?.translateTargetLang || globalReadSettings?.translateTargetLang;
  // 获取当前翻译服务提供商
  const translationProvider = (globalViewSettings?.translationProvider || globalReadSettings?.translationProvider || 'deepl') as 'deepl' | 'azure' | 'google';

  // 获取翻译服务的详细状态信息
  const getTranslationStatus = () => {
    // 获取可用的翻译服务
    const availableTranslators = getTranslators().filter(
      (t) => (t.authRequired ? !!token : true) && !t.quotaExceeded
    );
    
    // 检查是否有可用的翻译服务
    if (availableTranslators.length === 0) {
      if (!token) {
        return {
          available: false,
          reason: 'login_required',
          message: _('Login Required'),
        };
      } else {
        return {
          available: false,
          reason: 'quota_exceeded',
          message: _('Quota Exceeded'),
        };
      }
    }

    // 对于首页翻译，只要有翻译服务可用就允许翻译
    // 具体的语言匹配检查由各个文本组件自己处理

    return {
      available: true,
      reason: 'available',
      message: '',
    };
  };

  // 检查翻译功能是否可用
  const translationStatus = getTranslationStatus();
  const isTranslationAvailable = translationStatus.available;

  // 生成工具提示文本
  const getTooltipText = () => {
    if (isSaving) {
      return _('Saving translation settings...');
    }

    if (!isTranslationAvailable) {
      switch (translationStatus.reason) {
        case 'login_required':
          return _('Translation requires login');
        case 'quota_exceeded':
          return _('Daily translation quota reached. Select another translate service to proceed.');
        case 'same_language':
          return _('Please select a different target language');
        default:
          return _('Translation not available');
      }
    }

    if (translationEnabled) {
      return _('Disable Translation') + (targetLanguage ? ` (${_('Translate To')}: ${targetLanguage})` : '');
    } else {
      return _('Enable Translation') + (targetLanguage ? ` (${_('Translate To')}: ${targetLanguage})` : '');
    }
  };

  // 处理翻译开关切换
  const handleToggleTranslation = async () => {
    if (!isTranslationAvailable || isSaving) {
      return;
    }

    const newTranslationEnabled = !translationEnabled;
    setTranslationEnabled(newTranslationEnabled);
    setIsSaving(true);

    // 更新全局视图设置
    const updatedSettings = {
      ...settings,
      globalViewSettings: {
        ...globalViewSettings,
        translationEnabled: newTranslationEnabled,
      },
    };

    // 保存到状态管理器
    setSettings(updatedSettings);
    
    try {
      // 持久化保存设置
      await saveSettings(envConfig, updatedSettings);
      
      // 显示成功提示（可以在这里添加toast通知）
      console.log('Translation settings saved successfully');
    } catch (error) {
      console.error('Failed to save translation settings:', error);
      // 如果保存失败，回滚状态
      setTranslationEnabled(!newTranslationEnabled);
      
      // 这里可以添加错误提示
      // 例如：showErrorToast(_('Failed to save translation settings'));
    } finally {
      setIsSaving(false);
    }
  };

  // 监听全局设置变化，同步本地状态
  useEffect(() => {
    if (globalViewSettings?.translationEnabled !== undefined) {
      setTranslationEnabled(globalViewSettings.translationEnabled);
    }
  }, [globalViewSettings?.translationEnabled]);

  // 确保翻译服务提供商可用
  useEffect(() => {
    if (!translationProvider && globalReadSettings && globalViewSettings) {
      const availableTranslators = getTranslators().filter(
        (t) => (t.authRequired ? !!token : true) && !t.quotaExceeded
      );
      
      if (availableTranslators.length > 0) {
        // 使用第一个可用的翻译服务
        const defaultProvider = availableTranslators[0]!.name;
        const updatedSettings = {
          ...settings,
          globalReadSettings: {
            ...globalReadSettings,
            translationProvider: defaultProvider,
          },
          globalViewSettings: {
            ...globalViewSettings,
            translationProvider: defaultProvider,
          },
        };
        setSettings(updatedSettings);
        saveSettings(envConfig, updatedSettings);
      }
    }
  }, [translationProvider, token, globalReadSettings, globalViewSettings, settings, setSettings, saveSettings, envConfig]);

  return (
    <Button
      icon={
        <RiTranslateAi 
          className={
            isSaving 
              ? 'text-yellow-500 animate-pulse' 
              : translationEnabled 
                ? 'text-blue-500' 
                : 'text-base-content'
          }
        />
      }
      disabled={!isTranslationAvailable || isSaving}
      onClick={handleToggleTranslation}
      tooltip={getTooltipText()}
      tooltipDirection='bottom'
    />
  );
};

export default LibraryTranslationToggler; 