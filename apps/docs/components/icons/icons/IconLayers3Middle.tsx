// Generated from svgs/IconLayers3Middle.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconLayers3Middle = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><g opacity=".4"><path d="M15.106 11.554a.5.5 0 0 1 0 .894l-6.659 3.33-.107.045c-.22.08-.46.08-.68 0l-.107-.046-6.658-3.329a.5.5 0 0 1 0-.895l1.988-.994 1.677.838-1.206.604L8 14.323l4.646-2.322-1.207-.604 1.678-.838z" /><path fillRule="evenodd" d="M7.553.223a1 1 0 0 1 .894 0l6.659 3.33a.5.5 0 0 1 0 .894l-6.659 3.33-.107.045a1 1 0 0 1-.68 0l-.107-.046L.895 4.447a.5.5 0 0 1 0-.894zM3.354 4 8 6.322 12.646 4 8 1.677z" clipRule="evenodd" /></g><path d="M15.106 7.554a.5.5 0 0 1 0 .894l-6.659 3.33c-.281.14-.613.14-.894 0L.895 8.447a.5.5 0 0 1 0-.894l1.988-.995 4.222 2.112a2 2 0 0 0 1.79 0l4.222-2.112z" /></svg>
	);
};

export { IconLayers3Middle as ReactComponent };
