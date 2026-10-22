import { useState } from 'react';

interface AvatarProps {
    src: string;
    name: string;
}

/** 博主头像; 加载失败时退回首字符 */
export default function Avatar({ src, name }: AvatarProps) {
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const failed = failedSrc === src;

    if (src && !failed) {
        return (
            <img
                src={src}
                alt={name}
                onError={() => setFailedSrc(src)}
                className="w-8 h-8 rounded-full object-cover bg-gray-100"
            />
        );
    }
    return (
        <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
            {name.slice(0, 1)}
        </div>
    );
}
