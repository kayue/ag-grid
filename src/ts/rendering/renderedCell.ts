import {Utils as _} from "../utils";
import {Column} from "../entities/column";
import {RowNode} from "../entities/rowNode";
import {GridOptionsWrapper} from "../gridOptionsWrapper";
import {ExpressionService} from "../expressionService";
import {SelectionRendererFactory} from "../selectionRendererFactory";
import {RowRenderer} from "./rowRenderer";
import {TemplateService} from "../templateService";
import {ColumnController, ColumnApi} from "../columnController/columnController";
import {ValueService} from "../valueService";
import {EventService} from "../eventService";
import {Constants} from "../constants";
import {Events} from "../events";
import {RenderedRow} from "./renderedRow";
import {Autowired, PostConstruct, Optional, Context} from "../context/context";
import {GridApi} from "../gridApi";
import {FocusedCellController} from "../focusedCellController";
import {IContextMenuFactory} from "../interfaces/iContextMenuFactory";
import {IRangeController} from "../interfaces/iRangeController";
import {GridCell} from "../entities/gridCell";
import {FocusService} from "../misc/focusService";
import {ICellEditor} from "./cellEditors/iCellEditor";
import {CellEditorFactory} from "./cellEditors/cellEditorFactory";
import {Component} from "../widgets/component";
import {PopupService} from "../widgets/popupService";
import {PopupEditorWrapper} from "./cellEditors/popupEditorWrapper";
import {ICellRenderer, ICellRendererFunc} from "./cellRenderers/iCellRenderer";
import {CellRendererFactory} from "./cellRenderers/cellRendererFactory";

export class RenderedCell extends Component {

    @Autowired('context') private context: Context;
    @Autowired('columnApi') private columnApi: ColumnApi;
    @Autowired('gridApi') private gridApi: GridApi;
    @Autowired('gridOptionsWrapper') private gridOptionsWrapper: GridOptionsWrapper;
    @Autowired('expressionService') private expressionService: ExpressionService;
    @Autowired('selectionRendererFactory') private selectionRendererFactory: SelectionRendererFactory;
    @Autowired('rowRenderer') private rowRenderer: RowRenderer;
    @Autowired('$compile') private $compile: any;
    @Autowired('templateService') private templateService: TemplateService;
    @Autowired('valueService') private valueService: ValueService;
    @Autowired('eventService') private eventService: EventService;
    @Autowired('columnController') private columnController: ColumnController;
    @Optional('rangeController') private rangeController: IRangeController;
    @Autowired('focusedCellController') private focusedCellController: FocusedCellController;
    @Optional('contextMenuFactory') private contextMenuFactory: IContextMenuFactory;
    @Autowired('focusService') private focusService: FocusService;
    @Autowired('cellEditorFactory') private cellEditorFactory: CellEditorFactory;
    @Autowired('cellRendererFactory') private cellRendererFactory: CellRendererFactory;
    @Autowired('popupService') private popupService: PopupService;

    private static PRINTABLE_CHARACTERS = 'qwertyuiopasdfghjklzxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM1234567890!"£$%^&*()_+-=[];\'#,./\|<>?:@~{}';

    private eGridCell: HTMLElement; // the outer cell
    private eSpanWithValue: HTMLElement; // inner cell
    private eCellWrapper: HTMLElement;
    private eParentOfValue: HTMLElement;

    private gridCell: GridCell; // this is a pojo, not a gui element

    // we do not use this in this class, however the renderedRow wants to konw this
    private eParentRow: HTMLElement;

    private column: Column;
    private node: RowNode;
    private rowIndex: number;
    private editingCell: boolean;
    private cellEditorInPopup: boolean;
    private hideEditorPopup: Function;

    private scope: any;

    private cellRendererMap: {[key: string]: Function};
    private eCheckbox: HTMLInputElement;
    private cellEditor: ICellEditor;
    private cellRenderer: ICellRenderer;

    private value: any;
    private checkboxSelection: boolean;
    private renderedRow: RenderedRow;

    private firstRightPinned = false;
    private lastLeftPinned = false;

    constructor(column: any,
                cellRendererMap: {[key: string]: any},
                node: any, rowIndex: number, scope: any,
                renderedRow: RenderedRow) {
        super('<div/>');

        // because we reference eGridCell everywhere in this class,
        // we keep a local reference
        this.eGridCell = this.getGui();

        this.column = column;
        this.cellRendererMap = cellRendererMap;

        this.node = node;
        this.rowIndex = rowIndex;
        this.scope = scope;
        this.renderedRow = renderedRow;

        this.gridCell = new GridCell(rowIndex, node.floating, column);
    }

    public destroy(): void {
        super.destroy();
        if (this.cellEditor && this.cellEditor.destroy) {
            this.cellEditor.destroy();
        }
        if (this.cellRenderer && this.cellRenderer.destroy) {
            this.cellRenderer.destroy();
        }
    }

    private setPinnedClasses(): void {
        var firstPinnedChangedListener = () => {
            if (this.firstRightPinned !== this.column.isFirstRightPinned()) {
                this.firstRightPinned = this.column.isFirstRightPinned();
                _.addOrRemoveCssClass(this.eGridCell, 'ag-cell-first-right-pinned', this.firstRightPinned);
            }

            if (this.lastLeftPinned !== this.column.isLastLeftPinned()) {
                this.lastLeftPinned = this.column.isLastLeftPinned();
                _.addOrRemoveCssClass(this.eGridCell, 'ag-cell-last-left-pinned', this.lastLeftPinned);
            }
        };

        this.column.addEventListener(Column.EVENT_FIRST_RIGHT_PINNED_CHANGED, firstPinnedChangedListener);
        this.column.addEventListener(Column.EVENT_LAST_LEFT_PINNED_CHANGED, firstPinnedChangedListener);
        this.addDestroyFunc( () => {
            this.column.removeEventListener(Column.EVENT_FIRST_RIGHT_PINNED_CHANGED, firstPinnedChangedListener);
            this.column.removeEventListener(Column.EVENT_LAST_LEFT_PINNED_CHANGED, firstPinnedChangedListener);
        });

        firstPinnedChangedListener();
    }

    public getParentRow(): HTMLElement {
        return this.eParentRow;
    }

    public setParentRow(eParentRow: HTMLElement): void {
        this.eParentRow = eParentRow;
    }

    public calculateCheckboxSelection() {
        // never allow selection on floating rows
        if (this.node.floating) {
            return false;
        }

        // if boolean set, then just use it
        var colDef = this.column.getColDef();
        if (typeof colDef.checkboxSelection === 'boolean') {
            return colDef.checkboxSelection;
        }

        // if function, then call the function to find out. we first check colDef for
        // a function, and if missing then check gridOptions, so colDef has precedence
        var selectionFunc: Function;
        if (typeof colDef.checkboxSelection === 'function') {
            selectionFunc = <Function>colDef.checkboxSelection;
        }
        if (!selectionFunc && this.gridOptionsWrapper.getCheckboxSelection()) {
            selectionFunc = this.gridOptionsWrapper.getCheckboxSelection();
        }
        if (selectionFunc) {
            var params = this.createParams();
            return selectionFunc(params);
        }

        return false;
    }

    public getColumn(): Column {
        return this.column;
    }

    private getValue(): any {
        var data = this.getDataForRow();
        return this.valueService.getValueUsingSpecificData(this.column, data, this.node);
    }

    private getDataForRow() {
        if (this.node.footer) {
            // if footer, we always show the data
            return this.node.data;
        } else if (this.node.group) {
            // if header and header is expanded, we show data in footer only
            var footersEnabled = this.gridOptionsWrapper.isGroupIncludeFooter();
            var suppressHideHeader = this.gridOptionsWrapper.isGroupSuppressBlankHeader();
            if (this.node.expanded && footersEnabled && !suppressHideHeader) {
                return undefined;
            } else {
                return this.node.data;
            }
        } else {
            // otherwise it's a normal node, just return data as normal
            return this.node.data;
        }
    }

    private setLeftOnCell(): void {
        var leftChangedListener = () => {
            var newLeft = this.column.getLeft();
            if (_.exists(newLeft)) {
                this.eGridCell.style.left = this.column.getLeft() + 'px';
            } else {
                this.eGridCell.style.left = '';
            }
        };

        this.column.addEventListener(Column.EVENT_LEFT_CHANGED, leftChangedListener);
        this.addDestroyFunc( () => {
            this.column.removeEventListener(Column.EVENT_LEFT_CHANGED, leftChangedListener);
        });

        leftChangedListener();
    }

    private addRangeSelectedListener(): void {
        if (!this.rangeController) {
            return;
        }
        var rangeCountLastTime: number = 0;
        var rangeSelectedListener = () => {

            var rangeCount = this.rangeController.getCellRangeCount(this.gridCell);
            if (rangeCountLastTime !== rangeCount) {
                _.addOrRemoveCssClass(this.eGridCell, 'ag-cell-range-selected', rangeCount!==0);
                _.addOrRemoveCssClass(this.eGridCell, 'ag-cell-range-selected-1', rangeCount===1);
                _.addOrRemoveCssClass(this.eGridCell, 'ag-cell-range-selected-2', rangeCount===2);
                _.addOrRemoveCssClass(this.eGridCell, 'ag-cell-range-selected-3', rangeCount===3);
                _.addOrRemoveCssClass(this.eGridCell, 'ag-cell-range-selected-4', rangeCount>=4);
                rangeCountLastTime = rangeCount;
            }
        };
        this.eventService.addEventListener(Events.EVENT_RANGE_SELECTION_CHANGED, rangeSelectedListener);
        this.addDestroyFunc( ()=> {
            this.eventService.removeEventListener(Events.EVENT_RANGE_SELECTION_CHANGED, rangeSelectedListener);
        });
        rangeSelectedListener();
    }

    private addHighlightListener(): void {
        if (!this.rangeController) {
            return;
        }

        var clipboardListener = (event: any) => {
            var cellId = this.gridCell.createId();
            var shouldFlash = event.cells[cellId];
            if (shouldFlash) {
                this.animateCellWithHighlight();
            }
        };
        this.eventService.addEventListener(Events.EVENT_FLASH_CELLS, clipboardListener);
        this.addDestroyFunc( ()=> {
            this.eventService.removeEventListener(Events.EVENT_FLASH_CELLS, clipboardListener);
        });
    }

    private addChangeListener(): void {
        var cellChangeListener = (event: any) => {
            if (event.column === this.column) {
                this.refreshCell();
                this.animateCellWithDataChanged();
            }
        };
        this.addDestroyableEventListener(this.node, RowNode.EVENT_CELL_CHANGED, cellChangeListener);
    }

    private animateCellWithDataChanged(): void {
        if (this.gridOptionsWrapper.isEnableCellChangeFlash() || this.column.getColDef().enableCellChangeFlash) {
            this.animateCell('data-changed');
        }
    }

    private animateCellWithHighlight(): void {
        this.animateCell('highlight');
    }

    private animateCell(cssName: string): void {
        var fullName = 'ag-cell-' + cssName;
        var animationFullName = 'ag-cell-' + cssName + '-animation';
        // we want to highlight the cells, without any animation
        _.addCssClass(this.eGridCell, fullName);
        _.removeCssClass(this.eGridCell, animationFullName);
        // then once that is applied, we remove the highlight with animation
        setTimeout( ()=> {
            _.removeCssClass(this.eGridCell, fullName);
            _.addCssClass(this.eGridCell, animationFullName);
            setTimeout( ()=> {
                // and then to leave things as we got them, we remove the animation
                _.removeCssClass(this.eGridCell, animationFullName);
            }, 1000);
        }, 500);
    }

    private addCellFocusedListener(): void {
        // set to null, not false, as we need to set 'ag-cell-no-focus' first time around
        var cellFocusedLastTime: boolean = null;
        var cellFocusedListener = (event?: any) => {
            var cellFocused = this.focusedCellController.isCellFocused(this.gridCell);
            if (cellFocused !== cellFocusedLastTime) {
                _.addOrRemoveCssClass(this.eGridCell, 'ag-cell-focus', cellFocused);
                _.addOrRemoveCssClass(this.eGridCell, 'ag-cell-no-focus', !cellFocused);
                cellFocusedLastTime = cellFocused;
            }
            if (cellFocused && event && event.forceBrowserFocus) {
                this.eGridCell.focus();
            }
        };
        this.eventService.addEventListener(Events.EVENT_CELL_FOCUSED, cellFocusedListener);
        this.addDestroyFunc( ()=> {
            this.eventService.removeEventListener(Events.EVENT_CELL_FOCUSED, cellFocusedListener);
        });
        cellFocusedListener();
    }

    private setWidthOnCell(): void {
        var widthChangedListener = () => {
            this.eGridCell.style.width = this.column.getActualWidth() + "px";
        };

        this.column.addEventListener(Column.EVENT_WIDTH_CHANGED, widthChangedListener);
        this.addDestroyFunc( () => {
            this.column.removeEventListener(Column.EVENT_WIDTH_CHANGED, widthChangedListener);
        });

        widthChangedListener();
    }

    @PostConstruct
    public init(): void {
        this.value = this.getValue();
        this.checkboxSelection = this.calculateCheckboxSelection();

        this.setLeftOnCell();
        this.setWidthOnCell();
        this.setPinnedClasses();
        this.addRangeSelectedListener();
        this.addHighlightListener();
        this.addChangeListener();
        this.addCellFocusedListener();
        this.addKeyDownListener();
        this.addKeyPressListener();
        this.addFocusListener();

        // only set tab index if cell selection is enabled
        if (!this.gridOptionsWrapper.isSuppressCellSelection()) {
            this.eGridCell.setAttribute("tabindex", "-1");
        }

        // these are the grid styles, don't change between soft refreshes
        this.addClasses();
        this.setInlineEditingClass();
        this.createParentOfValue();
        this.populateCell();
    }

    private onEnterKeyDown(): void {
        if (this.editingCell) {
            this.stopEditing();
            this.focusCell(true);
        } else {
            this.startEditingIfEnabled(Constants.KEY_ENTER);
        }
    }

    private onF2KeyDown(): void {
        if (!this.editingCell) {
            this.startEditingIfEnabled(Constants.KEY_F2);
        }
    }

    private onEscapeKeyDown(): void {
        if (this.editingCell) {
            this.stopEditing(true);
            this.focusCell(true);
        }
    }

    private onPopupEditorClosed(): void {
        if (this.editingCell) {
            this.stopEditing(true);

            // we only focus cell again if this cell is still focused. it is possible
            // it is not focused if the user cancelled the edit by clicking on another
            // cell outside of this one
            if (this.focusedCellController.isCellFocused(this.gridCell)) {
                this.focusCell(true);
            }
        }
    }

    private onTabKeyDown(event: any): void {
        var editNextCell: boolean;
        if (this.editingCell) {
            // if editing, we stop editing, then start editing next cell
            this.stopEditing();
            editNextCell = true;
        } else {
            // otherwise we just move to the next cell
            editNextCell = false;
        }
        this.rowRenderer.moveFocusToNextCell(this.rowIndex, this.column, this.node.floating, event.shiftKey, editNextCell);
        event.preventDefault();
    }

    private onBackspaceOrDeleteKeyPressed(key: number): void {
        if (!this.editingCell) {
            this.startEditingIfEnabled(key);
        }
    }

    private onSpaceKeyPressed(): void {
        if (!this.editingCell && this.gridOptionsWrapper.isRowSelection()) {
            var selected = this.node.isSelected();
            this.node.setSelected(!selected);
        }
        // prevent default as space key, by default, moves browser scroll down
        event.preventDefault();
    }

    private onNavigationKeyPressed(event: any, key: number): void {
        if (this.editingCell) {
            this.stopEditing();
        }
        // if (!this.editingCell) {
            this.rowRenderer.navigateToNextCell(key, this.rowIndex, this.column, this.node.floating);
        // }
        // if we don't prevent default, the grid will scroll with the navigation keys
        event.preventDefault();
    }

    private addFocusListener(): void {
        var that = this;
        var focusListener = function(event: FocusEvent) {
            if (that.editingCell &&!that.cellEditorInPopup && that.hasFocusLeftCell(event)) {
                that.stopEditing();
            }
        };
        this.focusService.addListener(focusListener);
        this.addDestroyFunc( () => {
            this.focusService.removeListener(focusListener);
        });
    }

    private hasFocusLeftCell(event: FocusEvent): boolean {
        // if the user clicks outside this cell, then relatedTarget
        // will be the new cell (or outside the grid completely).
        // to check if inside this cell, we walk up the DOM tree
        // looking for our eGridCell, and if we don't find it,
        // we know focus was lost to outside the cell.
        var eTarget = <Node> event.target;
        var found = false;
        while (eTarget) {
            if (eTarget === this.eGridCell) {
                found = true;
            }
            eTarget = eTarget.parentNode;
        }

        return !found;
    }

    private addKeyPressListener(): void {
        var that = this;
        var keyPressListener = function(event: any) {
            if (!that.editingCell) {
                var pressedChar = String.fromCharCode(event.charCode);
                if (pressedChar === ' ') {
                    that.onSpaceKeyPressed();
                } else {
                    if (RenderedCell.PRINTABLE_CHARACTERS.indexOf(pressedChar)>=0) {
                        that.startEditingIfEnabled(null, pressedChar);
                        // if we don't prevent default, then the keypress also gets applied to the text field
                        // (at least when doing the default editor), but we need to allow the editor to decide
                        // what it wants to do.
                        event.preventDefault();
                    }
                }
            }
        };
        this.eGridCell.addEventListener('keypress', keyPressListener);
        this.addDestroyFunc( () => {
            this.eGridCell.removeEventListener('keypress', keyPressListener);
        });
    }

    private onKeyDown(event: KeyboardEvent): void {
        var key = event.which || event.keyCode;

        switch (key) {
            case Constants.KEY_ENTER:
                this.onEnterKeyDown();
                break;
            case Constants.KEY_F2:
                this.onF2KeyDown();
                break;
            case Constants.KEY_ESCAPE:
                this.onEscapeKeyDown();
                break;
            case Constants.KEY_TAB:
                this.onTabKeyDown(event);
                break;
            case Constants.KEY_BACKSPACE:
            case Constants.KEY_DELETE:
                this.onBackspaceOrDeleteKeyPressed(key);
                break;
            case Constants.KEY_DOWN:
            case Constants.KEY_UP:
            case Constants.KEY_RIGHT:
            case Constants.KEY_LEFT:
                this.onNavigationKeyPressed(event, key);
                break;
        }
    }

    private addKeyDownListener(): void {
        var editingKeyListener = this.onKeyDown.bind(this);
        this.eGridCell.addEventListener('keydown', editingKeyListener);
        this.addDestroyFunc( () => {
            this.eGridCell.removeEventListener('keydown', editingKeyListener);
        });
    }

    private createCellEditor(keyPress?: number, charPress?: string): ICellEditor {
        var colDef = this.column.getColDef();

        var cellEditor = this.cellEditorFactory.createCellEditor(colDef.cellEditor);

        if (cellEditor.init) {
            var params = {
                value: this.getValue(),
                keyPress: keyPress,
                charPress: charPress,
                column: this.column,
                node: this.node,
                api: this.gridOptionsWrapper.getApi(),
                columnApi: this.gridOptionsWrapper.getColumnApi(),
                context: this.gridOptionsWrapper.getContext(),
                onKeyDown: this.onKeyDown.bind(this),
                stopEditing: this.stopEditingAndFocus.bind(this)
            };

            if (colDef.cellEditorParams) {
                _.assign(params, colDef.cellEditorParams);
            }

            if (cellEditor.init) {
                cellEditor.init(params);
            }
        }

        return cellEditor;
    }

    // cell editors call this, when they want to stop for reasons other
    // than what we pick up on. eg selecting from a dropdown ends editing.
    private stopEditingAndFocus(): void {
        this.stopEditing();
        this.focusCell(true);
    }

    // called by rowRenderer when user navigates via tab key
    public startEditingIfEnabled(keyPress?: number, charPress?: string) {

        if (!this.isCellEditable()) {
            return;
        }

        this.cellEditor = this.createCellEditor(keyPress, charPress);

        if (!this.cellEditor.getGui) {
            console.warn(`ag-Grid: cellEditor for column ${this.column.getId()} is missing getGui() method`);
            return;
        }

        this.editingCell = true;
        this.cellEditorInPopup = this.cellEditor.isPopup && this.cellEditor.isPopup();
        this.setInlineEditingClass();

        if (this.cellEditorInPopup) {
            this.addPopupCellEditor();
        } else {
            this.addInCellEditor();
        }

        if (this.cellEditor.afterGuiAttached) {
            this.cellEditor.afterGuiAttached();
        }
    }

    private addInCellEditor(): void {
        _.removeAllChildren(this.eGridCell);
        this.eGridCell.appendChild(this.cellEditor.getGui());

        if (this.gridOptionsWrapper.isAngularCompileRows()) {
            this.$compile(this.eGridCell)(this.scope);
        }
    }

    private addPopupCellEditor(): void {
        var ePopupGui = this.cellEditor.getGui();

        this.hideEditorPopup = this.popupService.addAsModalPopup(
            ePopupGui,
            true,
            // callback for when popup disappears
            ()=> {
                // we only call stopEditing if we are editing, as
                // it's possible the popup called 'stop editing'
                // before this, eg if 'enter key' was pressed on
                // the editor
                if (this.editingCell) {
                    this.onPopupEditorClosed();
                }
            }
        );

        this.popupService.positionPopupOverComponent({
            eventSource: this.eGridCell,
            ePopup: ePopupGui,
            keepWithinBounds: true
        });

        if (this.gridOptionsWrapper.isAngularCompileRows()) {
            this.$compile(ePopupGui)(this.scope);
        }
    }

    public focusCell(forceBrowserFocus: boolean): void {
        this.focusedCellController.setFocusedCell(this.rowIndex, this.column, this.node.floating, forceBrowserFocus);
    }

    private stopEditing(reset: boolean = false) {
        this.editingCell = false;

        var newValue = this.cellEditor.getValue();

        if (!reset) {
            this.valueService.setValue(this.node, this.column, newValue);
            this.value = this.getValue();
        }

        if (this.cellEditor.destroy) {
            this.cellEditor.destroy();
        }

        if (this.cellEditorInPopup) {
            this.hideEditorPopup();
            this.hideEditorPopup = null;
        } else {
            _.removeAllChildren(this.eGridCell);
            if (this.checkboxSelection) {
                this.eGridCell.appendChild(this.eCellWrapper);
            }
        }

        this.setInlineEditingClass();

        this.refreshCell();
    }

    private createParams(): any {
        var params = {
            node: this.node,
            data: this.node.data,
            value: this.value,
            rowIndex: this.rowIndex,
            colDef: this.column.getColDef(),
            $scope: this.scope,
            context: this.gridOptionsWrapper.getContext(),
            api: this.gridApi,
            columnApi: this.columnApi
        };
        return params;
    }

    private createEvent(event: any, eventSource?: any): any {
        var agEvent = this.createParams();
        agEvent.event = event;
        //agEvent.eventSource = eventSource;
        return agEvent;
    }

    public isCellEditable() {
        if (this.editingCell) {
            return false;
        }

        // never allow editing of groups
        if (this.node.group) {
            return false;
        }

        return this.column.isCellEditable(this.node);
    }

    public onMouseEvent(eventName: string, mouseEvent: MouseEvent, eventSource: HTMLElement): void {
        switch (eventName) {
            case 'click': this.onCellClicked(mouseEvent); break;
            case 'mousedown': this.onMouseDown(); break;
            case 'dblclick': this.onCellDoubleClicked(mouseEvent, eventSource); break;
            case 'contextmenu': this.onContextMenu(mouseEvent); break;
        }
    }

    private onContextMenu(mouseEvent: MouseEvent): void {

        // to allow us to debug in chrome, we ignore the event if ctrl is pressed,
        // thus the normal menu is displayed
        if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
            return;
        }

        var colDef = this.column.getColDef();
        var agEvent: any = this.createEvent(mouseEvent);
        this.eventService.dispatchEvent(Events.EVENT_CELL_CONTEXT_MENU, agEvent);

        if (colDef.onCellContextMenu) {
            colDef.onCellContextMenu(agEvent);
        }

        if (this.contextMenuFactory && !this.gridOptionsWrapper.isSuppressContextMenu()) {
            this.contextMenuFactory.showMenu(this.node, this.column, this.value, mouseEvent);
            mouseEvent.preventDefault();
        }
    }

    private onCellDoubleClicked(mouseEvent: MouseEvent, eventSource: HTMLElement) {
        var colDef = this.column.getColDef();
        // always dispatch event to eventService
        var agEvent: any = this.createEvent(mouseEvent, eventSource);
        this.eventService.dispatchEvent(Events.EVENT_CELL_DOUBLE_CLICKED, agEvent);

        // check if colDef also wants to handle event
        if (typeof colDef.onCellDoubleClicked === 'function') {
            colDef.onCellDoubleClicked(agEvent);
        }

        if (!this.gridOptionsWrapper.isSingleClickEdit()) {
            this.startEditingIfEnabled();
        }
    }

    private onMouseDown(): void {
        // we pass false to focusCell, as we don't want the cell to focus
        // also get the browser focus. if we did, then the cellRenderer could
        // have a text field in it, for example, and as the user clicks on the
        // text field, the text field, the focus doesn't get to the text
        // field, instead to goes to the div behind, making it impossible to
        // select the text field.
        this.focusCell(false);

        // if it's a right click, then if the cell is already in range,
        // don't change the range, however if the cell is not in a range,
        // we set a new range
        if (this.rangeController) {
            var thisCell = this.gridCell;
            var cellAlreadyInRange = this.rangeController.isCellInAnyRange(thisCell);
            if (!cellAlreadyInRange) {
                this.rangeController.setRangeToCell(thisCell);
            }
        }
    }

    private onCellClicked(mouseEvent: MouseEvent): void {
        var agEvent = this.createEvent(mouseEvent, this);
        this.eventService.dispatchEvent(Events.EVENT_CELL_CLICKED, agEvent);

        var colDef = this.column.getColDef();

        if (colDef.onCellClicked) {
            colDef.onCellClicked(agEvent);
        }

        if (this.gridOptionsWrapper.isSingleClickEdit()) {
            this.startEditingIfEnabled();
        }
    }

    // if we are editing inline, then we don't have the padding in the cell (set in the themes)
    // to allow the text editor full access to the entire cell
    private setInlineEditingClass(): void {
        var editingInline = this.editingCell && !this.cellEditorInPopup;
        _.addOrRemoveCssClass(this.eGridCell, 'ag-cell-inline-editing', editingInline);
        _.addOrRemoveCssClass(this.eGridCell, 'ag-cell-not-inline-editing', !editingInline);
    }
    
    private populateCell() {
        // populate
        this.putDataIntoCell();
        // style
        this.addStylesFromColDef();
        this.addClassesFromColDef();
        this.addClassesFromRules();
    }

    private addStylesFromColDef() {
        var colDef = this.column.getColDef();
        if (colDef.cellStyle) {
            var cssToUse: any;
            if (typeof colDef.cellStyle === 'function') {
                var cellStyleParams = {
                    value: this.value,
                    data: this.node.data,
                    node: this.node,
                    colDef: colDef,
                    column: this.column,
                    $scope: this.scope,
                    context: this.gridOptionsWrapper.getContext(),
                    api: this.gridOptionsWrapper.getApi()
              };
                var cellStyleFunc = <Function>colDef.cellStyle;
                cssToUse = cellStyleFunc(cellStyleParams);
            } else {
                cssToUse = colDef.cellStyle;
            }

            if (cssToUse) {
                _.addStylesToElement(this.eGridCell, cssToUse);
            }
        }
    }

    private addClassesFromColDef() {
        var colDef = this.column.getColDef();
        if (colDef.cellClass) {
          var classToUse: any;

            if (typeof colDef.cellClass === 'function') {
                var cellClassParams = {
                    value: this.value,
                    data: this.node.data,
                    node: this.node,
                    colDef: colDef,
                    $scope: this.scope,
                    context: this.gridOptionsWrapper.getContext(),
                    api: this.gridOptionsWrapper.getApi()
                };
                var cellClassFunc = <(cellClassParams: any) => string|string[]> colDef.cellClass;
                classToUse = cellClassFunc(cellClassParams);
            } else {
                classToUse = colDef.cellClass;
            }

            if (typeof classToUse === 'string') {
                _.addCssClass(this.eGridCell, classToUse);
            } else if (Array.isArray(classToUse)) {
                classToUse.forEach( (cssClassItem: string)=> {
                    _.addCssClass(this.eGridCell, cssClassItem);
                });
            }
        }
    }

    private addClassesFromRules() {
        var colDef = this.column.getColDef();
        var classRules = colDef.cellClassRules;
        if (typeof classRules === 'object' && classRules !== null) {

            var params = {
                value: this.value,
                data: this.node.data,
                node: this.node,
                colDef: colDef,
                rowIndex: this.rowIndex,
                api: this.gridOptionsWrapper.getApi(),
                context: this.gridOptionsWrapper.getContext()
            };

            var classNames = Object.keys(classRules);
            for (var i = 0; i < classNames.length; i++) {
                var className = classNames[i];
                var rule = classRules[className];
                var resultOfRule: any;
                if (typeof rule === 'string') {
                    resultOfRule = this.expressionService.evaluate(rule, params);
                } else if (typeof rule === 'function') {
                    resultOfRule = rule(params);
                }
                if (resultOfRule) {
                    _.addCssClass(this.eGridCell, className);
                } else {
                    _.removeCssClass(this.eGridCell, className);
                }
            }
        }
    }

    private createParentOfValue() {
        if (this.checkboxSelection) {
            this.eCellWrapper = document.createElement('span');
            _.addCssClass(this.eCellWrapper, 'ag-cell-wrapper');
            this.eGridCell.appendChild(this.eCellWrapper);

            //this.createSelectionCheckbox();
            this.eCheckbox = this.selectionRendererFactory.createSelectionCheckbox(this.node, this.rowIndex, this.renderedRow.addEventListener.bind(this.renderedRow));
            this.eCellWrapper.appendChild(this.eCheckbox);

            // eventually we call eSpanWithValue.innerHTML = xxx, so cannot include the checkbox (above) in this span
            this.eSpanWithValue = document.createElement('span');
            _.addCssClass(this.eSpanWithValue, 'ag-cell-value');

            this.eCellWrapper.appendChild(this.eSpanWithValue);

            this.eParentOfValue = this.eSpanWithValue;
        } else {
            _.addCssClass(this.eGridCell, 'ag-cell-value');
            this.eParentOfValue = this.eGridCell;
        }
    }

    public isVolatile() {
        return this.column.getColDef().volatile;
    }

    public refreshCell(animate = false) {

        this.value = this.getValue();

        if (this.cellRenderer && this.cellRenderer.refresh) {
            // if the cell renderer has a refresh method, we call this instead of doing a refresh
            // note: should pass in params here instead of value?? so that client has formattedValue
            var params = this.createRendererAndRefreshParams(this.formatValue(this.value));
            this.cellRenderer.refresh(params);
            // need to check rules. note, we ignore colDef classes and styles, these are assumed to be static
            this.addClassesFromRules();
        } else {
            // otherwise we rip out the cell and replace it
            _.removeAllChildren(this.eParentOfValue);

            // remove old renderer component if it exists
            if (this.cellRenderer && this.cellRenderer.destroy) {
                this.cellRenderer.destroy();
            }
            this.cellRenderer = null;

            this.populateCell();

            // if angular compiling, then need to also compile the cell again (angular compiling sucks, please wait...)
            if (this.gridOptionsWrapper.isAngularCompileRows()) {
                this.$compile(this.eGridCell)(this.scope);
            }
        }

        if (animate) {
            this.animateCellWithDataChanged();
        }
    }

    private formatValue(value: any): string {
        var formatter: (value:any)=>string;
        var colDef = this.column.getColDef();
        // if floating, give preference to the floating formatter
        if (this.node.floating) {
            formatter = colDef.floatingCellFormatter ? colDef.floatingCellFormatter : colDef.cellFormatter;
        } else {
            formatter = colDef.cellFormatter;
        }
        var result: string = null;
        if (formatter) {
            var params = {
                value: value,
                node: this.node,
                column: this.column,
                $scope: this.scope,
                rowIndex: this.rowIndex,
                api: this.gridOptionsWrapper.getApi(),
                context: this.gridOptionsWrapper.getContext()
            };
            result = formatter(params);
        }
        return result;
    }

    private putDataIntoCell() {
        // template gets preference, then cellRenderer, then do it ourselves
        var colDef = this.column.getColDef();
        var valueFormatted = this.formatValue(this.value);

        if (colDef.template) {
            this.eParentOfValue.innerHTML = colDef.template;
        } else if (colDef.templateUrl) {
            var template = this.templateService.getTemplate(colDef.templateUrl, this.refreshCell.bind(this, true));
            if (template) {
                this.eParentOfValue.innerHTML = template;
            }
        } else if (colDef.floatingCellRenderer && this.node.floating) {
            this.useCellRenderer(colDef.floatingCellRenderer, colDef.floatingCellRendererParams, valueFormatted);
        } else if (colDef.cellRenderer) {
            this.useCellRenderer(colDef.cellRenderer, colDef.cellRendererParams, valueFormatted);
        } else {
            // if we insert undefined, then it displays as the string 'undefined', ugly!
            var valueToRender = _.exists(valueFormatted) ? valueFormatted : this.value;
            if (_.exists(valueToRender) && valueToRender !== '') {
                this.eParentOfValue.innerHTML = this.value.toString();
            }
        }
    }

    private createRendererAndRefreshParams(valueFormatted: string): any {
        var params = {
            value: this.value,
            valueFormatted: valueFormatted,
            valueGetter: this.getValue,
            formatValue: this.formatValue.bind(this),
            data: this.node.data,
            node: this.node,
            colDef: this.column.getColDef(),
            column: this.column,
            $scope: this.scope,
            rowIndex: this.rowIndex,
            api: this.gridOptionsWrapper.getApi(),
            context: this.gridOptionsWrapper.getContext(),
            refreshCell: this.refreshCell.bind(this),
            eGridCell: this.eGridCell,
            eParentOfValue: this.eParentOfValue,
            addRenderedRowListener: this.renderedRow.addEventListener.bind(this.renderedRow)
        };
        return params;
    }
    
    private useCellRenderer(cellRendererKey: {new(): ICellRenderer} | ICellRendererFunc | string, cellRendererParams: {}, valueFormatted: string) {

        var colDef = this.column.getColDef();

        var params = this.createRendererAndRefreshParams(valueFormatted);

        if (cellRendererParams) {
            _.assign(params, colDef.cellEditorParams);
        }

        var cellRenderer: {new(): ICellRenderer} | ICellRendererFunc;
        // if it's a string, then we look the cellRenderer up
        if (typeof cellRendererKey === 'string') {
            cellRenderer = this.cellRendererFactory.getCellRenderer(<string> cellRendererKey);
            if (_.missing(cellRenderer)) {
                // this is a bug in users config, they specified a cellRenderer that doesn't exist,
                // the factory already printed to console, so here we just skip
                return;
            }
        } else {
            cellRenderer = <{new(): ICellRenderer} | ICellRendererFunc> cellRendererKey;
        }

        var resultFromRenderer: HTMLElement | string;
        // we check if the class has the 'getGui' method to know if it's a component
        var rendererIsAComponent = ('getGui' in (<any>cellRenderer).prototype);
        // if it's a component, we create and initialise it
        if (rendererIsAComponent) {
            var CellRendererComponent = <{new(): ICellRenderer}> cellRenderer;
            this.cellRenderer = new CellRendererComponent();
            this.context.wireBean(this.cellRenderer);
            
            if (this.cellRenderer.init) {
                this.cellRenderer.init(params);
            }

            resultFromRenderer = this.cellRenderer.getGui();
        } else {
            // otherwise it's a function, so we just use it
            var cellRendererFunc = <ICellRendererFunc> cellRenderer;
            resultFromRenderer = cellRendererFunc(params);
        }

        if (resultFromRenderer===null || resultFromRenderer==='') {
            return;
        }

        if (_.isNodeOrElement(resultFromRenderer)) {
            // a dom node or element was returned, so add child
            this.eParentOfValue.appendChild( <HTMLElement> resultFromRenderer);
        } else {
            // otherwise assume it was html, so just insert
            this.eParentOfValue.innerHTML = <string> resultFromRenderer;
        }
    }

    private addClasses() {
        _.addCssClass(this.eGridCell, 'ag-cell');
        this.eGridCell.setAttribute("colId", this.column.getColId());

        if (this.node.group && this.node.footer) {
            _.addCssClass(this.eGridCell, 'ag-footer-cell');
        }
        if (this.node.group && !this.node.footer) {
            _.addCssClass(this.eGridCell, 'ag-group-cell');
        }
    }

}
