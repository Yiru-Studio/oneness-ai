'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: Props) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [isLoading, setIsLoading] = useState(false);

  const handleSendCode = () => {
    if (!email) return;
    setStep('code');
  };

  const handleLogin = async () => {
    if (!code) return;
    setIsLoading(true);
    try {
      await login(email, code);
      onClose();
      window.location.href = '/projects';
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50"
         onClick={onClose}>
      <div className="bg-white rounded-2xl p-8 w-[400px] relative"
           onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-semibold text-center mb-2">欢迎来到 Oneness-AI</h2>
        <p className="text-sm text-[var(--color-text-secondary)] text-center mb-6">
          使用邮箱继续
        </p>

        {step === 'email' ? (
          <div className="space-y-4">
            <input
              type="email"
              placeholder="电子邮箱"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none transition-colors"
            />
            <button
              onClick={handleSendCode}
              disabled={!email}
              className="w-full bg-[var(--color-primary)] text-white py-3 rounded-xl font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              使用邮箱继续
            </button>
            <p className="text-xs text-[var(--color-text-secondary)] text-center">
              未注册的邮箱将自动创建账号
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-[var(--color-text-secondary)] text-center mb-2">
              验证码已发送至 {email}
            </div>
            <input
              type="text"
              placeholder="请输入验证码"
              value={code}
              onChange={e => setCode(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none transition-colors text-center text-2xl tracking-[0.5em]"
              maxLength={6}
            />
            <button
              onClick={handleLogin}
              disabled={!code || isLoading}
              className="w-full bg-[var(--color-primary)] text-white py-3 rounded-xl font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? '登录中...' : '登录'}
            </button>
            <button
              onClick={() => setStep('email')}
              className="w-full text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors"
            >
              更换邮箱
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
