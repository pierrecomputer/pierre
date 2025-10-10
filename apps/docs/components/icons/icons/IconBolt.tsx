// Generated from svgs/IconBolt.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconBolt = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M9.224.888c.501-.68 1.57-.141 1.321.666L9.177 6h2.807a.75.75 0 0 1 .589 1.215l-6.16 7.801c-.532.675-1.597.069-1.288-.734L6.772 10H3.995a.75.75 0 0 1-.604-1.195z" /></svg>
	);
};

export { IconBolt as ReactComponent };
