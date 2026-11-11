'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled,
  icon,
  ...props
}) => {
  const baseStyles =
    'relative inline-flex items-center justify-center font-medium select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5500] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0C] disabled:opacity-35 disabled:pointer-events-none rounded-xl tracking-tight';

  const variants = {
    primary: 'tactile-btn-primary font-semibold',
    secondary: 'tactile-btn-surface font-medium',
    outline:
      'bg-transparent border border-white/12 text-[#D4D4D8] hover:bg-white/[0.04] hover:text-white hover:border-white/20 transition-colors',
    danger:
      'bg-[#EF4444]/15 text-[#FCA5A5] border border-[#EF4444]/30 hover:bg-[#EF4444]/25 transition-colors',
    ghost:
      'bg-transparent text-[#8E8E98] hover:text-[#F4F4F6] hover:bg-white/[0.04] transition-colors',
  };

  const sizes = {
    sm: 'text-xs px-3.5 py-2 gap-1.5 h-9',
    md: 'text-[13px] px-4 py-2.5 gap-2 h-11',
    lg: 'text-sm px-5 py-3 gap-2.5 h-12',
  };

  return (
    <button
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{children}</span>
        </>
      ) : (
        <>
          {icon && <span className="flex-shrink-0">{icon}</span>}
          <span>{children}</span>
        </>
      )}
    </button>
  );
};
