// Generated from svgs/IconEmojiSmileFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconEmojiSmileFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path fillRule="evenodd" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m7-1c0 .501-.164.396-.415.235C6.42 7.129 6.218 7 6 7s-.42.13-.585.235C5.164 7.396 5 7.5 5 7c0-.828 0-2.5 1-2.5S7 6.172 7 7m4 0c0 .501-.164.396-.415.235C10.42 7.129 10.218 7 10 7s-.42.13-.585.235C9.164 7.396 9 7.5 9 7c0-.828 0-2.5 1-2.5s1 1.672 1 2.5m1.33 3.5a1 1 0 0 0-.865-1.5h-6.93a1 1 0 0 0-.865 1.5A5 5 0 0 0 8 13a5 5 0 0 0 4.33-2.5" clipRule="evenodd" /></svg>
	);
};

export { IconEmojiSmileFill as ReactComponent };
