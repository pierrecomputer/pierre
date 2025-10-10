// Generated from svgs/IconFolders.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconFolders = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M14.5 15h-10A1.5 1.5 0 0 1 3 13.5v-7A1.5 1.5 0 0 1 4.5 5h3.9a1.5 1.5 0 0 1 1.034.414l.632.6a1.5 1.5 0 0 0 1.034.415h3.4a1.5 1.5 0 0 1 1.5 1.5V13.5a1.5 1.5 0 0 1-1.5 1.5" /><path d="M13 5.429h-1.9a.5.5 0 0 1-.345-.138l-.63-.601A2.5 2.5 0 0 0 8.4 4H4.5A2.5 2.5 0 0 0 2 6.5V11h-.5A1.5 1.5 0 0 1 0 9.5v-7A1.5 1.5 0 0 1 1.5 1h3.9a1.5 1.5 0 0 1 1.034.414l.632.6A1.5 1.5 0 0 0 8.1 2.43h3.4a1.5 1.5 0 0 1 1.5 1.5z" opacity=".4" /></svg>
	);
};

export { IconFolders as ReactComponent };
