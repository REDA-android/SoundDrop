'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glass?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className,
  ...props
}) => {
  return (
    <div
      className={cn(
        'hardware-chassis rounded-[22px] p-5 sm:p-6 transition-all duration-200',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};
