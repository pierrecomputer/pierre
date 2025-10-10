// Generated from svgs/IconShieldKeyhole.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconShieldKeyhole = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M10 6a2 2 0 0 1-1.283 1.868l.628 2.51A.5.5 0 0 1 8.86 11H7.14a.5.5 0 0 1-.485-.621l.628-2.511A2 2 0 1 1 10 6" /><path fillRule="evenodd" d="M7.897 15.993h-.001l-.088-.014a7.35 7.35 0 0 1-.91-.236 8.5 8.5 0 0 1-2.155-1.065c-1.623-1.113-3.3-3.115-3.669-6.6l-.002-.024C1.024 7.387 1 2.934 1 2.25a.75.75 0 0 1 .75-.75c1.646 0 3.127-.354 4.2-.712C6.485.61 6.915.432 7.208.3A9 9 0 0 0 7.62.102a.8.8 0 0 1 .758 0l.081.042q.112.055.332.156c.293.132.723.31 1.258.488 1.073.358 2.554.712 4.2.712a.75.75 0 0 1 .75.75c0 .683-.024 5.137-.072 5.804l-.002.025c-.368 3.484-2.046 5.486-3.669 6.599a8.5 8.5 0 0 1-2.154 1.065 7 7 0 0 1-.91.236l-.09.014a.8.8 0 0 1-.206 0M8 1.587l-.177.081c-.332.15-.809.347-1.398.544-1.015.338-2.378.679-3.922.767.007 1.471.03 4.435.064 4.955.32 3 1.73 4.62 3.024 5.507.659.452 1.3.72 1.774.877a6 6 0 0 0 .635.17l.076-.016c.13-.028.323-.077.56-.154a7 7 0 0 0 1.773-.877c1.293-.887 2.703-2.507 3.024-5.507.034-.52.057-3.484.065-4.955a15.3 15.3 0 0 1-3.923-.767A15 15 0 0 1 8 1.587" clipRule="evenodd" /></svg>
	);
};

export { IconShieldKeyhole as ReactComponent };
