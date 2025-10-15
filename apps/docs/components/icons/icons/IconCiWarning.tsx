// Generated from svgs/IconCiWarning.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconCiWarning = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M7.997 0c2.788 0 8.866 11.839 7.9 13.645-.967 1.807-14.871 1.807-15.8 0S5.207 0 7.996 0m.272 1.707a2 2 0 0 0-.272-.179c-.056.03-.145.083-.27.178-.305.232-.684.607-1.117 1.13-.862 1.039-1.798 2.486-2.642 4.03-.842 1.539-1.56 3.112-2.006 4.382-.225.64-.365 1.159-.427 1.536l-.008.048c.343.122.856.243 1.525.347 1.35.21 3.123.321 4.93.321 1.808 0 3.584-.11 4.939-.32.683-.107 1.205-.23 1.553-.355h.001l-.007-.049c-.06-.374-.198-.891-.421-1.53-.444-1.267-1.163-2.84-2.007-4.38-.846-1.542-1.785-2.99-2.65-4.029-.434-.522-.815-.898-1.12-1.13" /><path d="M7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.553.553 0 0 1-1.1 0z" /><path d="M7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.553.553 0 0 1-1.1 0zM7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0" /><path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0" /></svg>
	);
};

export { IconCiWarning as ReactComponent };
