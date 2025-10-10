// Generated from svgs/IconReplyFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconReplyFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M1.146 7.94 5.94 3.147a.5.5 0 0 1 .854.354v2.293c5.255 0 7.4 2.862 7.962 7.654a.31.31 0 0 1-.309.346.32.32 0 0 1-.25-.123c-3.474-4.347-7.399-2.879-7.403-2.877v2.293a.5.5 0 0 1-.854.353L1.146 8.647a.5.5 0 0 1 0-.707" /></svg>
	);
};

export { IconReplyFill as ReactComponent };
