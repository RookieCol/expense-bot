import { Test, TestingModule } from '@nestjs/testing';
import { QueryHandler } from './query.handler';
import { SheetsService } from '../../google/sheets.service';
import { I18nService } from '../../i18n/i18n.service';
import { StepMessenger } from '../step-messenger.service';
import { MESSAGING_PORT } from '../../shared/messaging/messaging-port.interface';

const buildHandler = async (overrides: {
  getLastExpenses?: jest.Mock;
  getMonthlySummary?: jest.Mock;
}) => {
  const messaging = {
    sendText: jest.fn().mockResolvedValue({ messageId: 'bot-1' }),
  };
  const sheets = {
    getLastExpenses: overrides.getLastExpenses ?? jest.fn(),
    getMonthlySummary: overrides.getMonthlySummary ?? jest.fn(),
  };
  const step = {
    send: jest.fn().mockResolvedValue({ messageId: 'step-1' }),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      QueryHandler,
      { provide: MESSAGING_PORT, useValue: messaging },
      { provide: SheetsService, useValue: sheets },
      { provide: I18nService, useValue: new I18nService() },
      { provide: StepMessenger, useValue: step },
    ],
  }).compile();
  return { handler: module.get(QueryHandler), messaging, sheets, step };
};

describe('QueryHandler', () => {
  describe('handleRecentExpenses', () => {
    it('tells the user when there is nothing recorded yet', async () => {
      const getLastExpenses = jest.fn().mockResolvedValue([]);
      const { handler, messaging, step } = await buildHandler({
        getLastExpenses,
      });

      await handler.handleRecentExpenses('42');

      expect(messaging.sendText).toHaveBeenCalledTimes(1);
      expect(step.send).not.toHaveBeenCalled();
    });

    it('formats a multi-entry list with dividers between cards (snapshot)', async () => {
      const getLastExpenses = jest.fn().mockResolvedValue([
        {
          fecha: '2026-04-20',
          monto: 45000,
          proveedor: 'Mercado',
          categoria: 'Cleaning',
        },
        {
          fecha: '2026-04-19',
          monto: 12000,
          proveedor: 'Uber',
          categoria: 'Administration',
        },
      ]);
      const { handler, step } = await buildHandler({ getLastExpenses });

      await handler.handleRecentExpenses('42');

      expect(step.send).toHaveBeenCalledTimes(1);
      const body = step.send.mock.calls[0][1] as string;
      expect(body).toMatchSnapshot();
    });

    it('falls back to em-dash when provider is missing', async () => {
      const getLastExpenses = jest.fn().mockResolvedValue([
        {
          fecha: '2026-04-20',
          monto: 1000,
          proveedor: '',
          categoria: 'Other',
        },
      ]);
      const { handler, step } = await buildHandler({ getLastExpenses });

      await handler.handleRecentExpenses('42');
      const body = step.send.mock.calls[0][1] as string;
      expect(body).toContain('🏪 —');
    });

    it('sends the error message when sheets throws', async () => {
      const getLastExpenses = jest.fn().mockRejectedValue(new Error('quota'));
      const { handler, messaging, step } = await buildHandler({
        getLastExpenses,
      });

      await handler.handleRecentExpenses('42');

      expect(messaging.sendText).toHaveBeenCalledTimes(1);
      expect(step.send).not.toHaveBeenCalled();
    });
  });

  describe('handleMonthlySummary', () => {
    it('formats the summary with total, count and per-category lines (snapshot)', async () => {
      const getMonthlySummary = jest.fn().mockResolvedValue({
        total: 250000,
        cantidadGastos: 15,
        porCategoria: {
          Cleaning: 80000,
          Administration: 65000,
          Maintenance: 42000,
        },
      });
      const { handler, step } = await buildHandler({ getMonthlySummary });

      await handler.handleMonthlySummary('42');

      expect(step.send).toHaveBeenCalledTimes(1);
      const body = step.send.mock.calls[0][1] as string;
      // Replace the locale-dependent month header so the snapshot is stable.
      const stable = body.replace(
        /📊 \*Resumen de [^*]+\*/,
        '📊 SUMMARY_HEADER',
      );
      expect(stable).toMatchSnapshot();
    });

    it('sorts categories by spend descending', async () => {
      const getMonthlySummary = jest.fn().mockResolvedValue({
        total: 100,
        cantidadGastos: 3,
        porCategoria: {
          Small: 10,
          Huge: 100,
          Medium: 50,
        },
      });
      const { handler, step } = await buildHandler({ getMonthlySummary });

      await handler.handleMonthlySummary('42');

      const body = step.send.mock.calls[0][1] as string;
      const hugeIdx = body.indexOf('Huge');
      const mediumIdx = body.indexOf('Medium');
      const smallIdx = body.indexOf('Small');
      expect(hugeIdx).toBeLessThan(mediumIdx);
      expect(mediumIdx).toBeLessThan(smallIdx);
    });

    it('sends the error message when the sheet call fails', async () => {
      const getMonthlySummary = jest.fn().mockRejectedValue(new Error('auth'));
      const { handler, messaging, step } = await buildHandler({
        getMonthlySummary,
      });

      await handler.handleMonthlySummary('42');

      expect(messaging.sendText).toHaveBeenCalledTimes(1);
      expect(step.send).not.toHaveBeenCalled();
    });
  });
});
