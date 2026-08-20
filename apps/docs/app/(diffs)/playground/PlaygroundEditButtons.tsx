'use client';

// Header controls for a playground edit session: an Edit button, replaced by
// Cancel + Save while the session is active. The React component serves the
// React surfaces; the DOM builder serves the vanilla Virtualizer view. Both
// share the `.playground-edit-*` styles in globals.css.

interface EditSessionButtonsProps {
  editing: boolean;
  onEdit(): void;
  onCancel(): void;
  onSave(): void;
}

export function EditSessionButtons({
  editing,
  onEdit,
  onCancel,
  onSave,
}: EditSessionButtonsProps) {
  if (!editing) {
    return (
      <div className="playground-edit-actions">
        <button
          type="button"
          className="playground-edit-button"
          data-action="edit"
          onClick={onEdit}
        >
          Edit
        </button>
      </div>
    );
  }
  return (
    <div className="playground-edit-actions">
      <button
        type="button"
        className="playground-edit-button"
        data-action="cancel"
        onClick={onCancel}
      >
        Cancel
      </button>
      <button
        type="button"
        className="playground-edit-button"
        data-action="save"
        onClick={onSave}
      >
        Save
      </button>
    </div>
  );
}

export interface EditSessionButtonsElement {
  element: HTMLElement;
  setEditing(editing: boolean): void;
}

// DOM twin of EditSessionButtons. `setEditing` swaps which buttons show.
export function createEditSessionButtons(
  handlers: Omit<EditSessionButtonsProps, 'editing'>
): EditSessionButtonsElement {
  const element = document.createElement('div');
  element.className = 'playground-edit-actions';
  const createButton = (action: string, label: string, onClick: () => void) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'playground-edit-button';
    button.dataset.action = action;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  };
  const editButton = createButton('edit', 'Edit', handlers.onEdit);
  const cancelButton = createButton('cancel', 'Cancel', handlers.onCancel);
  const saveButton = createButton('save', 'Save', handlers.onSave);
  const setEditing = (editing: boolean) => {
    element.replaceChildren(
      ...(editing ? [cancelButton, saveButton] : [editButton])
    );
  };
  setEditing(false);
  return { element, setEditing };
}
