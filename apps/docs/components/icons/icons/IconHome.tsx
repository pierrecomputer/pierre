// Generated from svgs/IconHome.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconHome = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M8.5.192a.75.75 0 0 0-1 0l-7.25 6.5A.75.75 0 0 0 1 7.957V10c0 2.17.296 3.815 1.523 4.825.601.495 1.361.782 2.252.95S6.735 16 8 16s2.336-.058 3.225-.225c.891-.168 1.65-.455 2.252-.95C14.704 13.815 15 12.17 15 10V7.957a.75.75 0 0 0 .75-1.265L14 5.122V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v.829zm5 6.496V10c0 2.154-.329 3.134-.977 3.667-.336.277-.826.493-1.576.634a10 10 0 0 1-.947.126V9.5a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5v4.927a10 10 0 0 1-.947-.126c-.75-.141-1.24-.357-1.576-.634C2.829 13.134 2.5 12.154 2.5 10V6.688L8 1.758z" /></svg>
	);
};

export { IconHome as ReactComponent };
