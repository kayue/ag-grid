import {Utils as _} from '../utils';
import {SvgFactory} from "../svgFactory";
import {GridOptionsWrapper} from "../gridOptionsWrapper";
import {ColumnController} from "../columnController/columnController";
import {OldToolPanelDragAndDropService} from "../dragAndDrop/oldToolPanelDragAndDropService";
import {EventService} from "../eventService";
import {Events} from "../events";
import {AgList} from "../widgets/agList";
import {BorderLayout} from "../layout/borderLayout";

var svgFactory = SvgFactory.getInstance();

export default class ColumnSelectionPanel {

    private gridOptionsWrapper: GridOptionsWrapper;
    private columnController: ColumnController;
    private cColumnList: any;
    layout: any;
    private eRootPanel: any;
    private oldToolPanelDragAndDropService: OldToolPanelDragAndDropService;

    constructor(columnController: ColumnController, gridOptionsWrapper: GridOptionsWrapper, eventService: EventService, oldToolPanelDragAndDropService: OldToolPanelDragAndDropService) {
        this.oldToolPanelDragAndDropService = oldToolPanelDragAndDropService;
        this.gridOptionsWrapper = gridOptionsWrapper;
        this.columnController = columnController;

        this.setupComponents();

        eventService.addEventListener(Events.EVENT_COLUMN_EVERYTHING_CHANGED, this.columnsChanged.bind(this));
        eventService.addEventListener(Events.EVENT_COLUMN_MOVED, this.columnsChanged.bind(this));
        eventService.addEventListener(Events.EVENT_COLUMN_VISIBLE, this.columnsChanged.bind(this));
    }

    private columnsChanged() {
        this.cColumnList.setModel(this.columnController.getAllColumns());
    }

    public getDragSource() {
        return this.cColumnList.getUniqueId();
    }

    private columnCellRenderer(params: any) {
        var column = params.value;
        var colDisplayName = this.columnController.getDisplayNameForCol(column);

        var eResult = document.createElement('span');

        var eVisibleIcons = document.createElement('span');
        _.addCssClass(eVisibleIcons, 'ag-visible-icons');
        var eShowing = _.createIcon('columnVisible', this.gridOptionsWrapper, column, svgFactory.createColumnVisibleIcon);
        var eHidden = _.createIcon('columnHidden', this.gridOptionsWrapper, column, svgFactory.createColumnHiddenIcon);
        eVisibleIcons.appendChild(eShowing);
        eVisibleIcons.appendChild(eHidden);
        eShowing.style.display = column.visible ? '' : 'none';
        eHidden.style.display = column.visible ? 'none' : '';
        eResult.appendChild(eVisibleIcons);

        var eValue = document.createElement('span');
        eValue.innerHTML = colDisplayName;
        eResult.appendChild(eValue);

        if (!column.visible) {
            _.addCssClass(eResult, 'ag-column-not-visible');
        }

        // change visible if use clicks the visible icon, or if row is double clicked
        eVisibleIcons.addEventListener('click', showEventListener);

        var that = this;

        function showEventListener() {
            that.columnController.setColumnVisible(column, !column.visible);
        }

        return eResult;
    }

    private setupComponents() {

        this.cColumnList = new AgList(this.oldToolPanelDragAndDropService);
        this.cColumnList.setCellRenderer(this.columnCellRenderer.bind(this));
        this.cColumnList.addStyles({height: '100%', overflow: 'auto'});
        this.cColumnList.addItemMovedListener(this.onItemMoved.bind(this));
        this.cColumnList.setReadOnly(true);

        var localeTextFunc = this.gridOptionsWrapper.getLocaleTextFunc();
        var columnsLocalText = localeTextFunc('columns', 'Columns');

        var eNorthPanel = document.createElement('div');
        eNorthPanel.innerHTML = '<div style="text-align: center;">' + columnsLocalText + '</div>';

        this.layout = new BorderLayout({
            center: this.cColumnList.getGui(),
            north: eNorthPanel
        });
    }

    private onItemMoved(fromIndex: number, toIndex: number) {
        this.columnController.moveColumnByIndex(fromIndex, toIndex);
    }

    public getGui() {
        return this.eRootPanel.getGui();
    }
}
