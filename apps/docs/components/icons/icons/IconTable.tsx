// Generated from svgs/IconTable.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconTable = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M0 3.25A2.25 2.25 0 0 1 2.25 1h11.5A2.25 2.25 0 0 1 16 3.25v9.5A2.25 2.25 0 0 1 13.75 15H2.25A2.25 2.25 0 0 1 0 12.75zm2.25-.75a.75.75 0 0 0-.75.75V5h5.75V2.5zm6.5 0V5h5.75V3.25a.75.75 0 0 0-.75-.75zm5.75 4H8.75V9h5.75zm0 4H8.75v3h5a.75.75 0 0 0 .75-.75zm-7.25 3v-3H1.5v2.25c0 .414.336.75.75.75zM1.5 9h5.75V6.5H1.5z" /></svg>
	);
};

export { IconTable as ReactComponent };
