// Generated from svgs/IconTableRowAdd.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconTableRowAdd = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M0 3.25A2.25 2.25 0 0 1 2.25 1h11.5A2.25 2.25 0 0 1 16 3.25V8h-1.5V6.5H8.75V8h-1.5V6.5H1.5V8H0zM1.5 5h5.75V2.5h-5a.75.75 0 0 0-.75.75zm7.25-2.5V5h5.75V3.25a.75.75 0 0 0-.75-.75z" opacity=".4" /><path d="M0 9.75A.75.75 0 0 1 .75 9h14.5a.75.75 0 0 1 .75.75v3A2.25 2.25 0 0 1 13.75 15H2.25A2.25 2.25 0 0 1 0 12.75zm1.5.75v2.25c0 .414.336.75.75.75h5v-3zm7.25 0v3h5a.75.75 0 0 0 .75-.75V10.5z" /></svg>
	);
};

export { IconTableRowAdd as ReactComponent };
